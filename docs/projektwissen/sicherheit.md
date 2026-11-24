# Sicherheit

Stand: 24. November 2026.

## Täglicher Sicherheitscheck

Workflow [`.github/workflows/security.yml`](../../.github/workflows/security.yml),
einmal täglich (Cron um 6:17 Uhr UTC, also 7:17 Uhr im Winter und 8:17 Uhr im
Sommer). GitHub startet geplante Läufe oft erst Stunden später; deshalb prüft
jeder geplante Lauf, egal wann er startet. Eine Uhrzeit-Bedingung im Workflow
gibt es bewusst nicht: mit ihr wurde jeder verspätete Lauf ausgelassen und
trotzdem als grün gemeldet. Von Hand: Actions → Sicherheitscheck → „Run
workflow“.

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
- Aktueller Override in `package.json`: `effect` auf `3.22.4`, begrenzt auf
  `@prisma/config`. Das Konfigurations-Paket der Datenbank-CLI (`prisma`)
  pinnt eine ältere `effect`-Version; es wird nur von der CLI zum Laden von
  `prisma.config.ts` gebraucht. Der Eintrag entfällt, sobald `prisma` eine
  Version mit `effect` > 3.22.0 ausliefert (prüfen mit `npm ls effect`).
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
