import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { keyedFingerprint } from "@/lib/secret-box";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES } from "@/lib/login-limits";

export { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES };

/**
 * Sperre nach zu vielen falschen Passwoertern, in der Datenbank statt nur im
 * Prozessspeicher: Auf Vercel laufen viele Instanzen parallel, eine
 * In-Memory-Bremse (login-throttle.ts) greift dort nur pro Instanz. Das
 * Gegenstueck fuer den zweiten Faktor sitzt in two-factor.ts.
 *
 * Gezaehlt wird je (E-Mail, Client-IP) in AdminLoginLock – auch fuer
 * E-Mails ohne Konto, damit beide gleich antworten. Nach LOGIN_MAX_FAILURES
 * ist nur diese Kombination gesperrt – Anmeldungen von anderen Anschluessen
 * laufen weiter. Ueber alle IPs zusammen wird nur verlangsamt und getaktet
 * (loginSlowdownMs, waitForLoginPaceSlot), nie gesperrt; IPs mit frueherer
 * richtiger Passworteingabe nimmt die Taktung aus. E-Mail und IP liegen nur
 * als Abdruck mit dem Anwendungsschluessel in der Datenbank. IPv6-Adressen
 * zaehlen je /64-Netz (loginIpKey).
 *
 * Jeder Versuch wird VOR dem Passwortvergleich in der Datenbank reserviert
 * (ein bedingtes UPDATE mit `increment`). Frueher wurde erst gelesen, dann
 * verglichen und danach ein absoluter Zaehlerstand geschrieben: viele
 * gleichzeitige Anfragen sahen denselben Stand und zaehlten zusammen als ein
 * Fehlversuch – die Sperre liess sich so umgehen.
 */
/** Ab so vielen Fehlversuchen ueber alle IPs (im Sperrfenster) wird verlangsamt. */
export const LOGIN_SLOWDOWN_AFTER = LOGIN_MAX_FAILURES;
/** Verzoegerung und Takt je Versuch, solange die E-Mail ueber alle IPs viele Fehlversuche sieht. */
export const LOGIN_SLOWDOWN_MS = 2_000;
/** So lange wartet ein Versuch hoechstens auf einen freien Takt (unter den 10 s von Vercel). */
export const LOGIN_PACE_WAIT_MS = 4_000;
/** Abstand, in dem ein wartender Versuch erneut nach einem freien Takt fragt. */
const PACE_POLL_MS = 250;
/** So lange nimmt eine richtige Passworteingabe die IP von der Taktung aus. */
export const LOGIN_TRUST_DAYS = 30;
/** Eintraege ohne Versuch seit so langer Zeit werden weggeraeumt. */
const STALE_AFTER_MS = 24 * 60 * 60_000;

/** Ein Zaehler: eine E-Mail, eine Client-IP (beide als Abdruck). */
export type LoginLockKey = { emailHash: string; ipHash: string };

type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

/**
 * Minimalschnittstelle auf den Prisma-Client, damit die Logik in Tests gegen
 * eine Attrappe laufen kann.
 */
export interface LoginLockDb {
  adminLoginLock: {
    updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<LoginLockKey & { failures: number; lastAttemptAt: Date }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
    count(args: { where: Where }): Promise<number>;
    aggregate(args: { where: Where; _sum: { failures: true } }): Promise<{ _sum: { failures: number | null } }>;
  };
  adminLoginPace: {
    updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<{ emailHash: string; nextAllowedAt: Date }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
  };
}

const defaultDb: LoginLockDb = prisma;

/**
 * Teil der IP, nach dem gezaehlt wird: IPv4 unveraendert, IPv4 in IPv6
 * (::ffff:a.b.c.d) als IPv4, sonst IPv6 auf das /64-Netz gekuerzt – ein
 * Anschluss bekommt meist ein ganzes /64. Unlesbares bleibt, wie es ist.
 */
export function loginIpKey(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/%.*$/, "");
  if (!raw.includes(":")) return raw;
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];

  const halves = raw.split("::");
  if (halves.length > 2) return raw;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return raw;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Abdruck der Client-IP (IPv6 je /64); die IP selbst wird nicht gespeichert. */
export function loginIpHash(ip: string): string {
  return keyedFingerprint("admin-login-ip", loginIpKey(ip));
}

/** Abdruck der eingegebenen E-Mail, gross/klein gleich; sie selbst wird nicht gespeichert. */
export function loginEmailHash(email: string): string {
  return keyedFingerprint("admin-login-email", email.trim().toLowerCase());
}

export function loginLockKey(email: string, ip: string): LoginLockKey {
  return { emailHash: loginEmailHash(email), ipHash: loginIpHash(ip) };
}

function lockUntil(now: Date): Date {
  return new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000);
}

/**
 * Reserviert einen Passwort-Versuch fuer (E-Mail, IP). `false` heisst:
 * gesperrt, das Passwort wird gar nicht erst verglichen.
 *
 * Von N gleichzeitigen Anfragen kommen hoechstens so viele durch, wie bis
 * LOGIN_MAX_FAILURES noch frei sind – die Bedingung prueft die Datenbank
 * selbst, nicht ein zuvor gelesener Stand.
 */
export async function reserveLoginAttempt(
  key: LoginLockKey,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<boolean> {
  const reserve = () =>
    db.adminLoginLock.updateMany({
      where: { ...key, lockedUntil: null, failures: { lt: LOGIN_MAX_FAILURES } },
      data: { failures: { increment: 1 }, lastAttemptAt: now },
    });

  if ((await reserve()).count > 0) return true;

  // Eine abgelaufene Sperre setzt den Zaehler zurueck und belegt gleich den
  // ersten Versuch; von gleichzeitigen Anfragen gelingt das nur einer.
  const reopened = await db.adminLoginLock.updateMany({
    where: { ...key, lockedUntil: { lte: now } },
    data: { failures: 1, lockedUntil: null, lastAttemptAt: now },
  });
  if (reopened.count > 0) return true;

  // Noch kein Eintrag fuer diese IP: anlegen, der erste Versuch ist belegt.
  const created = await db.adminLoginLock.createMany({
    data: [{ ...key, failures: 1, lastAttemptAt: now }],
    skipDuplicates: true,
  });
  if (created.count > 0) return true;

  // Eine gleichzeitige Anfrage hat den Eintrag eben angelegt.
  if ((await reserve()).count > 0) return true;

  // Zaehler voll, aber (noch) keine Sperrzeit – etwa weil die Anfrage, die
  // den letzten Versuch belegt hat, vor dem Sperren abgebrochen ist. Sperrzeit
  // nachtragen, damit die IP nicht dauerhaft haengen bleibt.
  await lockLoginIfExhausted(key, now, db);
  return false;
}

/** Nach einem falschen Passwort: sperren, sobald der Zaehler voll ist. */
export async function lockLoginIfExhausted(
  key: LoginLockKey,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<void> {
  await db.adminLoginLock.updateMany({
    where: { ...key, lockedUntil: null, failures: { gte: LOGIN_MAX_FAILURES } },
    data: { lockedUntil: lockUntil(now), lastAttemptAt: now },
  });
}

/**
 * Nach einem richtigen Passwort: Zaehler dieser IP zuruecksetzen und die IP
 * als bekannt vermerken (nimmt sie von der Taktung aus). Eine bestehende
 * Sperre bleibt unangetastet (Bedingung `lockedUntil: null`), damit eine
 * spaet eintreffende Anfrage sie nicht wieder aufhebt.
 */
export async function clearLoginFailures(
  key: LoginLockKey,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<void> {
  await db.adminLoginLock.updateMany({
    where: { ...key, lockedUntil: null },
    data: { failures: 0, succeededAt: now, lastAttemptAt: now },
  });
}

/**
 * Gibt einen reservierten Versuch zurueck, der den Vergleich nicht erreicht
 * hat (kein Takt frei). Er zaehlt dann nicht als Fehlversuch.
 */
export async function releaseLoginAttempt(key: LoginLockKey, db: LoginLockDb = defaultDb): Promise<void> {
  await db.adminLoginLock.updateMany({
    where: { ...key, lockedUntil: null, failures: { gt: 0 } },
    data: { failures: { decrement: 1 } },
  });
}

/**
 * Neues Passwort (selbst oder durch den Super-Admin gesetzt): Sperren und
 * Fehlversuche zu dieser E-Mail entfallen an allen IPs.
 */
export async function resetLoginLocks(email: string, db: LoginLockDb = defaultDb): Promise<void> {
  await db.adminLoginLock.updateMany({
    where: { emailHash: loginEmailHash(email) },
    data: { failures: 0, lockedUntil: null },
  });
}

/**
 * Raeumt Eintraege weg, die seit einem Tag ruhen – ausser IPs, die in den
 * letzten LOGIN_TRUST_DAYS ein richtiges Passwort gesehen haben. Laeuft bei
 * jedem Versuch, damit die Tabelle auch ohne erfolgreiche Anmeldung nicht
 * waechst.
 */
export async function pruneLoginLocks(now = new Date(), db: LoginLockDb = defaultDb): Promise<void> {
  const stale = new Date(now.getTime() - STALE_AFTER_MS);
  const trustedSince = new Date(now.getTime() - LOGIN_TRUST_DAYS * 24 * 60 * 60_000);
  await db.adminLoginLock.deleteMany({
    where: {
      lastAttemptAt: { lt: stale },
      OR: [{ succeededAt: null }, { succeededAt: { lt: trustedSince } }],
    },
  });
  await db.adminLoginPace.deleteMany({ where: { nextAllowedAt: { lt: stale } } });
}

/**
 * Verzoegerung fuer den naechsten Versuch: 0, solange die E-Mail ueber alle
 * IPs zusammen im Sperrfenster weniger als LOGIN_SLOWDOWN_AFTER Fehlversuche
 * hat, sonst LOGIN_SLOWDOWN_MS. Bewusst keine Sperre am ganzen Konto – die
 * koennte jeder Fremde ausloesen.
 */
export async function loginSlowdownMs(
  emailHash: string,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<number> {
  const since = new Date(now.getTime() - LOGIN_LOCK_MINUTES * 60_000);
  const result = await db.adminLoginLock.aggregate({
    where: { emailHash, lastAttemptAt: { gte: since } },
    _sum: { failures: true },
  });
  return (result._sum.failures ?? 0) >= LOGIN_SLOWDOWN_AFTER ? LOGIN_SLOWDOWN_MS : 0;
}

/** Hat diese IP fuer diese E-Mail in den letzten LOGIN_TRUST_DAYS ein richtiges Passwort gesehen? */
export async function isKnownLoginIp(
  key: LoginLockKey,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<boolean> {
  const trustedSince = new Date(now.getTime() - LOGIN_TRUST_DAYS * 24 * 60 * 60_000);
  return (await db.adminLoginLock.count({ where: { ...key, succeededAt: { gte: trustedSince } } })) > 0;
}

/**
 * Takt ueber alle IPs: belegt den naechsten freien Zeitpunkt der E-Mail und
 * schiebt ihn um LOGIN_SLOWDOWN_MS weiter. Von gleichzeitigen Anfragen kommt
 * je Takt nur eine durch – anders als die blosse Wartezeit bremst das auch
 * parallele Anfragen.
 */
export async function takeLoginPaceSlot(
  emailHash: string,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<boolean> {
  const nextAllowedAt = new Date(now.getTime() + LOGIN_SLOWDOWN_MS);
  const taken = await db.adminLoginPace.updateMany({
    where: { emailHash, nextAllowedAt: { lte: now } },
    data: { nextAllowedAt },
  });
  if (taken.count > 0) return true;
  const created = await db.adminLoginPace.createMany({
    data: [{ emailHash, nextAllowedAt }],
    skipDuplicates: true,
  });
  return created.count > 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wartet bis zu `maxWaitMs` auf einen freien Takt der E-Mail und fragt dabei
 * alle PACE_POLL_MS erneut. `now` ist der Zeitpunkt beim Start; die Wartezeit
 * wird darauf aufgerechnet.
 */
export async function waitForLoginPaceSlot(
  emailHash: string,
  now = new Date(),
  db: LoginLockDb = defaultDb,
  maxWaitMs = LOGIN_PACE_WAIT_MS,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const waited = Date.now() - start;
    if (await takeLoginPaceSlot(emailHash, new Date(now.getTime() + waited), db)) return true;
    if (waited >= maxWaitMs) return false;
    await sleep(Math.min(PACE_POLL_MS, maxWaitMs - waited));
  }
}

/**
 * bcrypt-Hash eines Passworts, das niemand kennt. Damit ein unbekanntes Konto
 * nicht spuerbar schneller antwortet als ein bekanntes, laeuft auch dann ein
 * echter Vergleich mit denselben Kosten.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$tPNA94P44gf5rC3TNFFr/OMt4HF6aef5QS33gm5HpP6V43cURutca";

/**
 * Passwortpruefung mit Sperre je (E-Mail, IP) und Verlangsamung/Taktung je
 * E-Mail – gemeinsam fuer /api/login/precheck und authorize() in auth.ts.
 *
 * Gesperrt, unbekanntes Konto und falsches Passwort enden gleich: `valid:
 * false`. Bekannte und unbekannte E-Mails durchlaufen dieselben Schritte
 * (Zaehler, Verzoegerung, Takt), und in jedem Fall laeuft ein
 * bcrypt-Vergleich (ohne Konto oder bei Sperre gegen DUMMY_PASSWORD_HASH).
 * Bei `valid: true` setzt der Aufrufer den Zaehler mit clearLoginFailures(key)
 * zurueck, sobald feststeht, dass der Versuch nicht als Fehlversuch zaehlt.
 */
export async function checkLoginPassword(
  admin: { id: number; password: string } | null,
  email: string,
  password: string,
  clientIp: string,
  now = new Date(),
  db: LoginLockDb = defaultDb,
): Promise<{ valid: boolean; key: LoginLockKey }> {
  await pruneLoginLocks(now, db);
  const key = loginLockKey(email, clientIp);

  const start = Date.now();
  const delay = await loginSlowdownMs(key.emailHash, now, db);

  // Versuch in der Datenbank belegen, bevor verglichen wird: gleichzeitige
  // Anfragen koennen die Sperre so nicht unterlaufen.
  let allowed = await reserveLoginAttempt(key, now, db);

  // Viele Fehlversuche ueber alle IPs: nur einer je Takt kommt zum Vergleich.
  // Erst nach der Reservierung – ein gesperrter Anschluss belegt so keinen
  // Takt. Bekannte IPs sind vom Takt ausgenommen, damit Fremde niemanden
  // aussperren koennen. Wer keinen Takt bekommt, gibt den Versuch zurueck.
  if (allowed && delay > 0 && !(await isKnownLoginIp(key, now, db))) {
    allowed = await waitForLoginPaceSlot(key.emailHash, now, db);
    if (!allowed) await releaseLoginAttempt(key, db);
  }
  // Jeder Versuch wartet mindestens `delay`; die Wartezeit auf den Takt zaehlt mit.
  const remaining = delay - (Date.now() - start);
  if (remaining > 0) await sleep(remaining);

  const matches = await compare(password, allowed && admin ? admin.password : DUMMY_PASSWORD_HASH);
  const valid = allowed && !!admin && matches;
  if (allowed && !valid) await lockLoginIfExhausted(key, now, db);
  return { valid, key };
}
