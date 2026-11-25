#!/usr/bin/env bash
# Sucht im aktuellen Stand des Repos nach eingecheckten Geheimnissen.
# Aufgerufen vom CI (Pull Requests und Pushes) und vom taeglichen
# Sicherheitscheck; lokal: `bash scripts/secret-scan.sh`.
#
# Ausgabe nur Datei:Zeile, nie der Treffer selbst (das Ergebnis landet im
# Lauf-Protokoll und im Issue des Sicherheitschecks).
# Exit-Code 0 = nichts gefunden, 1 = moegliche Geheimnisse gefunden,
# 2 = Suche fehlgeschlagen.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Muster, je eines pro Format. Ein Treffer am Wortanfang/-ende wird ueber die
# Zeichenklassen davor/danach abgegrenzt, damit laengere Bezeichner nicht
# zufaellig passen.
patterns=(
  # Private Schluessel
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # GitHub, AWS, Stripe, Slack
  'ghp_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{40,}'
  'AKIA[0-9A-Z]{16}'
  'sk_live_[A-Za-z0-9]{20,}'
  'xox[abp]-[A-Za-z0-9-]{10,}'
  # Telegram-Bot-Token
  '[0-9]{8,10}:AA[A-Za-z0-9_-]{33}'
  # Geraete-Token (src/lib/tokens.ts: "dev_" + 24 Byte base64url = 32 Zeichen)
  '(^|[^A-Za-z0-9_])dev_[A-Za-z0-9_-]{32}([^A-Za-z0-9_-]|$)'
  # MCP-Token (src/lib/mcp/auth.ts: "mcp_" + 32 Byte base64url = 43 Zeichen)
  '(^|[^A-Za-z0-9_])mcp_[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)'
  # Vercel-Blob-Schreibtoken, Neon-Passwort, xAI-Schluessel
  'vercel_blob_rw_[A-Za-z0-9_]{20,}'
  '(^|[^A-Za-z0-9_])npg_[A-Za-z0-9]{12,}'
  '(^|[^A-Za-z0-9_])xai-[A-Za-z0-9]{40,}'
  # Postgres- und RTSP-Adressen mit Passwort
  "postgres(ql)?://[^ \"'<:]+:[^ \"'<@]+@[^ \"'<]+"
  "rtsps?://[^ \"'<:/@]+:[^ \"'<@,;]+@[^ \"'<,;]+"
)
pattern="($(IFS='|'; echo "${patterns[*]}"))"

# Lockfiles enthalten nur Paket-Pruefsummen. Ausgenommen sind ausserdem
# bekannte Platzhalter: die CI-Datenbank und Beispiel-Zugangsdaten in Doku,
# Beispielkonfiguration und Tests. Geprueft wird je Treffer (-o), nicht je
# Zeile: ein Platzhalter neben einem echten Wert verdeckt diesen nicht.
rtsp_placeholder='rtsps?://[^:]+:(p|geheim|PW|DEIN_PW|p%40ss%3Aword|[{]pw[}])@'
raw=$(mktemp)
trap 'rm -f "$raw"' EXIT
# git grep: 0 = Treffer, 1 = keine Treffer, alles andere = Fehler.
rc=0
git grep -noIE "$pattern" -- . ':!package-lock.json' ':!**/package-lock.json' ':!**/pnpm-lock.yaml' \
  > "$raw" || rc=$?
if [ "$rc" -gt 1 ]; then
  echo "Suche fehlgeschlagen (git grep Exit $rc)." >&2
  exit 2
fi
hits=$(grep -v 'postgres:postgres@localhost' "$raw" \
  | grep -vE 'user:pass(word)?@|USER:PASS|<[a-z_]+>:<[a-z_]+>@' \
  | grep -vE "^[^:]+:[0-9]+:${rtsp_placeholder}" \
  | cut -d: -f1,2 | sort -u || true)

if [ -n "$hits" ]; then
  echo "Moegliche Geheimnisse (Datei:Zeile):"
  echo "$hits"
  exit 1
fi
echo "Keine Geheimnisse gefunden."
