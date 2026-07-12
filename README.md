This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Telegram Tagesbericht (Vercel Cron)

1. **Umgebungsvariable `CRON_SECRET`** in Vercel anlegen (z. B. 32 Zeichen Zufall), **Production** (und ggf. Preview) aktivieren, danach **Redeploy**.
2. Ohne `CRON_SECRET` antwortet `/api/cron/telegram-report` mit **503** – der Job läuft dann nicht sichtbar „erfolgreich“.
3. Vercel sendet bei Cron-Aufrufen `Authorization: Bearer <CRON_SECRET>`. Der Wert muss **exakt** mit der Variable übereinstimmen.
4. Der Bericht wird nur gesendet, wenn die **Berliner Uhrzeit** (HH:mm) mit der in den Einstellungen gewählten Zeit übereinstimmt (Cron alle 15 Minuten).
5. Test manuell:  
   `curl -s -H "Authorization: Bearer DEIN_CRON_SECRET" "https://deine-domain.vercel.app/api/cron/telegram-report"`

## Push-Benachrichtigung „Gerät offline" (PWA / Web-Push)

Alle 5 Minuten prüft `/api/cron/device-offline-check`, ob Geräte offline gegangen
(oder wieder online gekommen) sind, und sendet Web-Push an alle im Dashboard
registrierten Browser/PWA-Geräte. Pro Offline-Episode gibt es genau eine
Benachrichtigung (Zustandsübergang, kein Spam).

**Einrichtung:**

1. VAPID-Schlüsselpaar erzeugen: `npx web-push generate-vapid-keys`
2. In Vercel als Umgebungsvariablen anlegen (Production, danach Redeploy):
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` – Public Key
   - `VAPID_PRIVATE_KEY` – Private Key
   - `VAPID_SUBJECT` – Kontakt, z. B. `mailto:admin@deine-domain.de`
3. `CRON_SECRET` muss gesetzt sein (siehe Telegram-Abschnitt) – der Cron nutzt dieselbe Auth.
4. Im Dashboard unter **Einstellungen → Push-Benachrichtigungen** auf jedem
   gewünschten Gerät „Auf diesem Gerät aktivieren" drücken.
   - **iPhone/iPad:** Die Seite muss zuerst über Safari **zum Home-Bildschirm
     hinzugefügt** und von dort geöffnet werden, sonst erlaubt iOS kein Web-Push.
5. Pro Gerät die Überwachung einschalten: Gerätedetail → **Bearbeiten** →
   **Offline-Benachrichtigung** (Opt-in, Standard: aus). Nur Geräte mit
   aktiviertem Schalter lösen Push-Meldungen aus.
5. Test manuell:  
   `curl -s -H "Authorization: Bearer DEIN_CRON_SECRET" "https://deine-domain.vercel.app/api/cron/device-offline-check"`

**Erkennung je Gerätetyp:** Raspberry Pi über Heartbeat (`lastUpdate` älter als
5 Min = offline), Shelly über die Shelly Cloud, GARDENA über die GARDENA Cloud.
Nuki wird nicht geprüft. Shelly-Geräte ohne Cloud-Anbindung (nur lokale IP)
können von Vercel aus nicht erreicht und daher nicht überwacht werden.
