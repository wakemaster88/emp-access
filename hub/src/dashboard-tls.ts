/**
 * HTTPS fuer das Dashboard mit einer eigenen, lokalen Zertifizierungsstelle.
 *
 * Warum: iPhone und iPad erlauben Service Worker (App-Huelle offline,
 * sauberes Verhalten als Home-Bildschirm-App) nur in einem sicheren
 * Kontext, also per HTTPS. Im LAN gibt es kein oeffentliches Zertifikat,
 * daher legt der Hub beim ersten Start selbst eine kleine CA an
 * (hub/.tls/ca.pem, 10 Jahre) und stellt damit ein Server-Zertifikat fuer
 * seine LAN-Adressen und seinen Namen aus. Das CA-Zertifikat installiert man
 * einmal auf dem Geraet (/ca.crt), danach ist https://<Hub>:8787 vertraut.
 *
 * Das Server-Zertifikat wird neu ausgestellt, wenn sich die IP-Adressen des
 * Hubs aendern oder es bald ablaeuft – die CA bleibt, das Geraet muss also
 * nichts neu installieren. Laufzeit 800 Tage: iOS lehnt laengere ab.
 *
 * Braucht nur `openssl` (auf macOS vorinstalliert). Fehlt es, laeuft das
 * Dashboard wie bisher nur per HTTP.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { networkInterfaces, hostname } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CONFIG, log } from "./config.js";

const run = promisify(execFile);

export const TLS_DIR = path.join(CONFIG.hubDir, ".tls");
const CA_KEY = path.join(TLS_DIR, "ca-key.pem");
const CA_CERT = path.join(TLS_DIR, "ca.pem");
const SRV_KEY = path.join(TLS_DIR, "server-key.pem");
const SRV_CERT = path.join(TLS_DIR, "server.pem");

const SERVER_DAYS = 800;
const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000;

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
  /** Namen und IPs im Zertifikat, fuer Log und Dashboard. */
  names: string[];
}

/** IPv4-Adressen des Hubs (ohne Loopback) plus Namen, unter denen er erreichbar ist. */
function wantedNames(): { dns: string[]; ips: string[] } {
  const ips = new Set<string>(["127.0.0.1"]);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) ips.add(a.address);
    }
  }
  const extra = (process.env.HUB_DASHBOARD_TLS_NAMES || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const dns = new Set<string>(["localhost"]);
  const host = hostname().replace(/\.local$/i, "");
  if (/^[\w-]+$/.test(host)) {
    dns.add(host);
    dns.add(`${host}.local`);
  }
  for (const n of extra) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(n)) ips.add(n);
    else if (/^[\w.-]+$/.test(n)) dns.add(n);
  }
  return { dns: [...dns], ips: [...ips] };
}

async function openssl(args: string[]): Promise<void> {
  await run("openssl", args, { timeout: 30_000 });
}

async function ensureCa(): Promise<void> {
  if (existsSync(CA_KEY) && existsSync(CA_CERT)) return;
  const cnf = path.join(TLS_DIR, "ca.cnf");
  await writeFile(
    cnf,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = v3_ca",
      "prompt = no",
      "[dn]",
      `CN = EMP-Access Hub CA (${hostname()})`,
      "O = EMP-Access",
      "[v3_ca]",
      "basicConstraints = critical, CA:TRUE, pathlen:0",
      "keyUsage = critical, keyCertSign, cRLSign",
      "subjectKeyIdentifier = hash",
      "",
    ].join("\n")
  );
  await openssl(["genrsa", "-out", CA_KEY, "2048"]);
  await openssl(["req", "-x509", "-new", "-key", CA_KEY, "-sha256", "-days", "3650", "-out", CA_CERT, "-config", cnf]);
  await rm(cnf, { force: true });
  log("Dashboard-HTTPS: neue lokale CA angelegt (hub/.tls/ca.pem)");
}

/** Passt das vorhandene Server-Zertifikat noch zu Adressen und Laufzeit? */
async function serverCertUsable(dns: string[], ips: string[]): Promise<boolean> {
  if (!existsSync(SRV_KEY) || !existsSync(SRV_CERT)) return false;
  try {
    const cert = new X509Certificate(await readFile(SRV_CERT));
    const ca = new X509Certificate(await readFile(CA_CERT));
    if (!cert.verify(ca.publicKey)) return false;
    if (new Date(cert.validTo).getTime() - Date.now() < RENEW_BEFORE_MS) return false;
    const san = new Set((cert.subjectAltName ?? "").split(/,\s*/));
    return dns.every((d) => san.has(`DNS:${d}`)) && ips.every((ip) => san.has(`IP Address:${ip}`));
  } catch {
    return false;
  }
}

async function issueServerCert(dns: string[], ips: string[]): Promise<void> {
  const cnf = path.join(TLS_DIR, "server.cnf");
  const csr = path.join(TLS_DIR, "server.csr");
  const san = [...dns.map((d) => `DNS:${d}`), ...ips.map((ip) => `IP:${ip}`)].join(",");
  await writeFile(
    cnf,
    [
      "[req]",
      "distinguished_name = dn",
      "prompt = no",
      "[dn]",
      `CN = ${dns[1] ?? "EMP-Access Hub"}`,
      "O = EMP-Access",
      "[ext]",
      "basicConstraints = critical, CA:FALSE",
      "keyUsage = critical, digitalSignature, keyEncipherment",
      "extendedKeyUsage = serverAuth",
      `subjectAltName = ${san}`,
      "",
    ].join("\n")
  );
  await openssl(["genrsa", "-out", SRV_KEY, "2048"]);
  await openssl(["req", "-new", "-key", SRV_KEY, "-out", csr, "-config", cnf]);
  await openssl([
    "x509", "-req", "-in", csr, "-CA", CA_CERT, "-CAkey", CA_KEY, "-CAcreateserial",
    "-out", SRV_CERT, "-days", String(SERVER_DAYS), "-sha256", "-extfile", cnf, "-extensions", "ext",
  ]);
  await rm(csr, { force: true });
  await rm(cnf, { force: true });
  log(`Dashboard-HTTPS: Zertifikat ausgestellt fuer ${[...dns, ...ips].join(", ")}`);
}

/**
 * Laedt (oder erzeugt) CA und Server-Zertifikat. null, wenn HTTPS
 * abgeschaltet ist oder openssl fehlt – das Dashboard laeuft dann nur per HTTP.
 */
export async function loadDashboardTls(): Promise<TlsMaterial | null> {
  if (/^(0|false|off|nein)$/i.test(process.env.HUB_DASHBOARD_TLS ?? "")) return null;
  try {
    await mkdir(TLS_DIR, { recursive: true, mode: 0o700 });
    await ensureCa();
    const { dns, ips } = wantedNames();
    if (!(await serverCertUsable(dns, ips))) await issueServerCert(dns, ips);
    return {
      key: await readFile(SRV_KEY),
      cert: await readFile(SRV_CERT),
      ca: await readFile(CA_CERT),
      names: [...dns, ...ips],
    };
  } catch (e) {
    log(`Dashboard-HTTPS nicht verfuegbar (nur HTTP): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** CA-Zertifikat als DER fuer die Installation auf iPhone/iPad/Mac. */
export function caDer(caPem: Buffer): Buffer {
  return Buffer.from(new X509Certificate(caPem).raw);
}
