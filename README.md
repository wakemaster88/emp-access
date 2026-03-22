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
