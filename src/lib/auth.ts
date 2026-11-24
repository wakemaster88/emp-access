import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";
import { isTwoFactorActive, verifySecondFactor } from "./two-factor";
import {
  DUMMY_PASSWORD_HASH,
  clearLoginFailures,
  isLoginLocked,
  lockLoginIfExhausted,
  reserveLoginAttempt,
} from "./login-lockout";
import { clearLoginThrottle, hitLoginThrottle } from "./login-throttle";
import { relyingPartyFrom, verifyPasskeyLogin } from "./passkey";

/** Sitzungsdauer: eine Woche statt der 30 Tage Standard. */
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
/** Wie oft ein JWT gegen die Datenbank geprueft wird (geloeschter Admin, deaktivierter Account). */
const SESSION_REVALIDATE_MS = 5 * 60_000;

/** `rv` = Zeitpunkt der letzten Pruefung, `sv` = Admin.sessionVersion beim Anmelden. */
type TokenWithCheck = { rv?: number; sv?: number };

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

        if (!admin) {
          // Gleiche Laufzeit wie bei einem bekannten Konto.
          await compare(credentials.password as string, DUMMY_PASSWORD_HASH);
          return null;
        }
        if (isLoginLocked(admin)) return null;
        // Versuch in der Datenbank belegen, bevor verglichen wird: viele
        // gleichzeitige Anfragen koennen die Sperre so nicht mehr unterlaufen.
        if (!(await reserveLoginAttempt(admin))) return null;

        const valid = await compare(
          credentials.password as string,
          admin.password
        );
        if (!valid) {
          await lockLoginIfExhausted(admin.id);
          return null;
        }

        // Deaktivierter Mandant: keine neue Sitzung. Der Passkey-Weg lehnt an
        // derselben Stelle ab (passkey.ts); ohne diese Pruefung kaeme man bis
        // zur naechsten Sitzungspruefung (5 Minuten) trotzdem hinein.
        if (admin.accountId != null && admin.account && !admin.account.isActive) {
          await clearLoginFailures(admin.id);
          return null;
        }

        // Zweiter Faktor wird ausschliesslich hier geprueft. Der Vorab-Check
        // beim Login sagt nur, ob ein Code noetig ist – wuerde er ihn selbst
        // einloesen, waere der Code fuer diesen Aufruf schon verbraucht.
        if (isTwoFactorActive(admin)) {
          const second = await verifySecondFactor(admin, credentials.code as string | undefined);
          if (!second.ok) {
            // Das Passwort war richtig: der belegte Passwort-Versuch zaehlt nicht.
            await clearLoginFailures(admin.id);
            return null;
          }
        }

        await prisma.admin.update({
          where: { id: admin.id },
          data: { lastLogin: new Date(), loginFailures: 0, loginLockedUntil: null },
        });
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
      if (admin.accountId != null && admin.account && !admin.account.isActive) return null;
      // Passwort geaendert oder „ueberall abmelden“: aeltere Sitzungen enden.
      // Sitzungen von vor der Einfuehrung tragen kein `sv` und gelten als 0.
      if (admin.sessionVersion !== ((token as TokenWithCheck).sv ?? 0)) return null;

      token.role = admin.role;
      token.accountId = admin.accountId;
      token.accountName = admin.account?.name ?? null;
      (token as TokenWithCheck).rv = Date.now();
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

export async function safeAuth(): Promise<Session | null> {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export { clearLoginFailures };
