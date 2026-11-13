# Sicherheit

Stand: 13. November 2026.

## Täglicher Sicherheitscheck

Workflow [`.github/workflows/security.yml`](../../.github/workflows/security.yml),
jeden Tag um 8 Uhr deutscher Zeit (Cron um 6 und 7 Uhr UTC, der Lauf, der
nicht 8 Uhr Berlin ist, wird ausgelassen). Von Hand: Actions → Sicherheitscheck
→ „Run workflow“.

Er prüft:

- bekannte Lücken in den Produktionspaketen von Cloud (`npm audit`), Hub
  (`hub/`, `npm audit`) und Webcams (`webcams/`, `pnpm audit`), ab „moderate“,
- eingecheckte Geheimnisse (private Schlüssel, GitHub-, AWS-, Stripe-,
  Slack- und Telegram-Tokens, Postgres-Adressen mit Passwort). Gemeldet wird
  nur Datei und Zeile, nie der Treffer.

Bei Befunden schlägt der Lauf fehl (GitHub schickt eine Mail) und das Issue
„Sicherheitscheck: Befunde“ wird angelegt oder um einen Kommentar ergänzt.

## Behebung

- Transitive Pakete mit Lücken über `overrides` heben: Cloud in
  `package.json`, Webcams in `webcams/pnpm-workspace.yaml`.
- `npm audit fix --force` nicht blind ausführen: es schlägt teils
  Herabstufungen vor (z. B. `@vercel/blob` auf 2.4.0).
- Geheimnisse, die im Repo gelandet sind, sofort beim Anbieter neu erzeugen;
  Löschen aus dem Repo allein reicht nicht, die Git-Historie ist öffentlich.

## Regeln im Code

- Geheimnisse (Webhook-Secrets, Cron-Secret, Tokens) immer zeitkonstant mit
  `secretsEqual` aus `src/lib/cron-auth.ts` vergleichen, nie mit `===`.
- Jede API-Route prüft selbst (es gibt keine Middleware): Sitzung
  (`getSessionWithDb`), Account-/Geräte-Token (`validateApiToken`),
  MCP-Token (`authenticateMcpToken`), Cron (`verifyCronAuth`) oder ein
  öffentliches Zufallstoken aus `src/lib/tokens.ts`.
