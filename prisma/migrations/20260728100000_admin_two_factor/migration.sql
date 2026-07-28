-- Zwei-Faktor-Authentifizierung (TOTP) fuer den Admin-Login.
ALTER TABLE "Admin"
  ADD COLUMN "twoFactorSecret" TEXT,
  ADD COLUMN "twoFactorEnabledAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorRecoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "twoFactorLastStep" INTEGER,
  ADD COLUMN "twoFactorFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "twoFactorLockedUntil" TIMESTAMP(3);
