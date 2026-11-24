import NextAuth, { type Session } from "next-auth";
import { headers } from "next/headers";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { isTwoFactorActive, verifySecondFactor } from "./two-factor";
import { checkLoginPassword, clearLoginFailures } from "./login-lockout";
import { clearLoginThrottle, hitLoginThrottle } from "./login-throttle";
import { relyingPartyFrom, verifyPasskeyLogin } from "./passkey";
import { requestClientIp } from "./rate-limit";
import { CROSS_SITE_HEADER } from "./cross-site";
import { createSessionRevalidator, revalidateOrKeep } from "./session-revalidate";

/** Sitzungsdauer: eine Woche statt der 30 Tage Standard. */
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
/** Wie oft ein JWT gegen die Datenbank geprueft wird (geloeschter Admin, deaktivierter Account). */
const SESSION_REVALIDATE_MS = 5 * 60_000;

/** `rv` = Zeitpunkt der letzten Pruefung, `sv` = Admin.sessionVersion beim Anmelden. */
type TokenWithCheck = { rv?: number; sv?: number };

/** Hoechstens eine Datenbankabfrage je Admin und Instanz in SESSION_REVALIDATE_MS. */
const revalidateSession = createSessionRevalidator(async (adminId) => {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: {
      role: true,
      accountId: true,
      sessionVersion: true,
      account: { select: { name: true, isActive: true } },
    },
  });
  if (!admin) return null;
  return {
    role: admin.role,
    accountId: admin.accountId,
    accountName: admin.account?.name ?? null,
    sessionVersion: admin.sessionVersion,
    accountActive: !(admin.accountId != null && admin.account && !admin.account.isActive),
  };
}, SESSION_REVALIDATE_MS);

function throttleKey(request: Request | undefined, email: string): string {
  const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `authorize|${ip}|${email.toLowerCase()}`;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email as string;

        // Der direkte Aufruf dieses Endpunkts umgeht /api/login/precheck und
        // dessen Bremse – deshalb hier dieselbe noch einmal (pro Instanz).
        const key = throttleKey(request, email);
        if (!hitLoginThrottle(key).allowed) return null;

        const admin = await prisma.admin.findUnique({
          where: { email },
          include: { account: true },
        });

        // Sperre je (E-Mail, Client-IP), Verlangsamung je E-Mail; ein
        // unbekanntes Konto durchlaeuft dieselben Schritte (login-lockout.ts).
        const ip = request ? requestClientIp(request.headers) : "-";
        const { valid, key: lockKey } = await checkLoginPassword(admin, email, credentials.password as string, ip);
        if (!admin || !valid) return null;

        // Deaktivierter Mandant: keine neue Sitzung. Der Passkey-Weg lehnt an
        // derselben Stelle ab (passkey.ts); ohne diese Pruefung kaeme man bis
        // zur naechsten Sitzungspruefung (5 Minuten) trotzdem hinein.
        if (admin.accountId != null && admin.account && !admin.account.isActive) {
          await clearLoginFailures(lockKey);
          return null;
        }

        // Zweiter Faktor wird ausschliesslich hier geprueft. Der Vorab-Check
        // beim Login sagt nur, ob ein Code noetig ist – wuerde er ihn selbst
        // einloesen, waere der Code fuer diesen Aufruf schon verbraucht.
        if (isTwoFactorActive(admin)) {
          const second = await verifySecondFactor(admin, credentials.code as string | undefined);
          if (!second.ok) {
            // Das Passwort war richtig: der belegte Passwort-Versuch zaehlt nicht.
            await clearLoginFailures(lockKey);
            return null;
          }
        }

        await prisma.admin.update({
          where: { id: admin.id },
          data: { lastLogin: new Date(), loginFailures: 0, loginLockedUntil: null },
        });
        await clearLoginFailures(lockKey);
        clearLoginThrottle(key);

        return {
          id: String(admin.id),
          email: admin.email,
          name: admin.name,
          role: admin.role,
          accountId: admin.accountId,
          accountName: admin.account?.name ?? null,
          sessionVersion: admin.sessionVersion,
        };
      },
    }),
    // Anmeldung per Passkey (WebAuthn). Ersetzt Passwort und zweiten Faktor:
    // der Passkey ist an die Domain gebunden und verlangt Face ID,
    // Fingerabdruck oder Geraete-PIN. Optionen kommen von /api/login/passkey.
    Credentials({
      id: "passkey",
      name: "passkey",
      credentials: {
        response: { label: "Passkey", type: "text" },
      },
      async authorize(credentials, request) {
        if (!credentials?.response) return null;
        const admin = await verifyPasskeyLogin(relyingPartyFrom(request.headers), credentials.response);
        if (!admin) return null;
        return {
          id: String(admin.id),
          email: admin.email,
          name: admin.name,
          role: admin.role,
          accountId: admin.accountId,
          accountName: admin.account?.name ?? null,
          sessionVersion: admin.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.accountId = user.accountId;
        token.accountName = user.accountName;
        (token as TokenWithCheck).rv = Date.now();
        (token as TokenWithCheck).sv = user.sessionVersion ?? 0;
        return token;
      }

      // Das JWT lebt bis zu einer Woche im Browser. Damit ein geloeschter
      // Admin, ein deaktivierter Account oder eine nach einem Passwortwechsel
      // veraltete Sitzung nicht so lange weiterarbeiten kann, wird das Token
      // alle paar Minuten gegen die Datenbank geprueft und bei Bedarf
      // verworfen (null = Sitzung beenden).
      const checkedAt = (token as TokenWithCheck).rv ?? 0;
      if (Date.now() - checkedAt < SESSION_REVALIDATE_MS) return token;

      const adminId = Number(token.sub);
      if (!Number.isInteger(adminId)) return null;
      // Ergebnis kommt hoechstens SESSION_REVALIDATE_MS alt aus dem
      // Prozessspeicher (session-revalidate.ts). Antwortet die Datenbank
      // nicht, bleibt das Token unveraendert (rv wird nicht fortgeschrieben):
      // ein Aussetzer meldet niemanden ab, die naechste Anfrage prueft neu.
      const check = await revalidateOrKeep(revalidateSession, adminId);
      if (!check) return token;
      const admin = check.state;
      if (!admin) return null;
      if (!admin.accountActive) return null;
      // Passwort geaendert oder „ueberall abmelden“: aeltere Sitzungen enden.
      // Sitzungen von vor der Einfuehrung tragen kein `sv` und gelten als 0.
      if (admin.sessionVersion !== ((token as TokenWithCheck).sv ?? 0)) return null;

      token.role = admin.role;
      token.accountId = admin.accountId;
      token.accountName = admin.accountName;
      // Zeitpunkt der echten Abfrage, nicht „jetzt“: sonst laege die naechste
      // Pruefung bis zu zwei Zeitfenster entfernt.
      (token as TokenWithCheck).rv = check.checkedAt;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.accountId = token.accountId as number | null;
        session.user.accountName = token.accountName as string | null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SEC, updateAge: 60 * 60 },
});

/**
 * true, wenn der Proxy die laufende Anfrage als schreibenden Aufruf einer
 * fremden Seite markiert hat (src/lib/cross-site.ts). Ausserhalb einer
 * Anfrage (kein headers()) gibt es keine Markierung.
 */
export async function markedCrossSite(): Promise<boolean> {
  try {
    return (await headers()).get(CROSS_SITE_HEADER) === "1";
  } catch {
    return false;
  }
}

/**
 * Sitzung oder null. Eine schreibende Anfrage einer fremden Seite (vom Proxy
 * markiert, src/lib/cross-site.ts) gilt als nicht angemeldet.
 */
export async function safeAuth(): Promise<Session | null> {
  try {
    if (await markedCrossSite()) return null;
    return await auth();
  } catch {
    return null;
  }
}

export { clearLoginFailures };
