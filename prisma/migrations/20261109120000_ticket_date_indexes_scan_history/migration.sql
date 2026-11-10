-- Ticket: Datums-Indizes fuer die "Tickets des Tages"-Abfragen von Kiosk,
-- Monitor und Dashboard (Status + Datumsbereich je Mandant).
CREATE INDEX IF NOT EXISTS "Ticket_accountId_endDate_idx" ON "Ticket"("accountId", "endDate");
CREATE INDEX IF NOT EXISTS "Ticket_accountId_createdAt_idx" ON "Ticket"("accountId", "createdAt");

-- Scan: beim Loeschen eines Geraets bleibt die Scan-Historie erhalten
-- (deviceId -> NULL statt Loeschen der Scans).
-- NOT VALID + VALIDATE haelt die Sperre auf der Scan-Tabelle kurz: das
-- Anlegen prueft keine Bestandszeilen, das Validieren laeuft ohne Schreibsperre.
ALTER TABLE "Scan" DROP CONSTRAINT IF EXISTS "Scan_deviceId_fkey";
ALTER TABLE "Scan"
  ADD CONSTRAINT "Scan_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Scan" VALIDATE CONSTRAINT "Scan_deviceId_fkey";

-- Indizes und Fremdschluessel aus dem Schema, die bisher keine Migration
-- angelegt hat (Bestand aus `prisma db push`). Auf einer Datenbank, die sie
-- schon hat, sind das No-ops. Eindeutige Indizes und Fremdschluessel brechen
-- die Migration nicht ab, falls Bestandsdaten sie verletzen - dann steht ein
-- Hinweis im Migrationsprotokoll.

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Account_subdomain_key" ON "Account"("subdomain");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Account_subdomain_key nicht angelegt: doppelte Werte vorhanden';
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Account_apiToken_key" ON "Account"("apiToken");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Account_apiToken_key nicht angelegt: doppelte Werte vorhanden';
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Admin_email_key" ON "Admin"("email");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Admin_email_key nicht angelegt: doppelte Werte vorhanden';
END $$;

CREATE INDEX IF NOT EXISTS "Admin_accountId_idx" ON "Admin"("accountId");

CREATE INDEX IF NOT EXISTS "Admin_email_idx" ON "Admin"("email");

CREATE INDEX IF NOT EXISTS "Device_accountId_idx" ON "Device"("accountId");

CREATE INDEX IF NOT EXISTS "Device_accessIn_idx" ON "Device"("accessIn");

CREATE INDEX IF NOT EXISTS "Device_accessOut_idx" ON "Device"("accessOut");

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_uuid_key" ON "Ticket"("uuid");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Ticket_uuid_key nicht angelegt: doppelte Werte vorhanden';
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_barcode_key" ON "Ticket"("barcode");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Ticket_barcode_key nicht angelegt: doppelte Werte vorhanden';
END $$;

CREATE INDEX IF NOT EXISTS "Ticket_accountId_idx" ON "Ticket"("accountId");

CREATE INDEX IF NOT EXISTS "Ticket_rfidCode_idx" ON "Ticket"("rfidCode");

CREATE INDEX IF NOT EXISTS "Ticket_qrCode_idx" ON "Ticket"("qrCode");

CREATE INDEX IF NOT EXISTS "Ticket_barcode_idx" ON "Ticket"("barcode");

CREATE INDEX IF NOT EXISTS "Ticket_accessAreaId_idx" ON "Ticket"("accessAreaId");

CREATE INDEX IF NOT EXISTS "Ticket_subscriptionId_idx" ON "Ticket"("subscriptionId");

CREATE INDEX IF NOT EXISTS "Ticket_serviceId_idx" ON "Ticket"("serviceId");

CREATE INDEX IF NOT EXISTS "Ticket_status_idx" ON "Ticket"("status");

CREATE INDEX IF NOT EXISTS "Ticket_accountId_uuid_idx" ON "Ticket"("accountId", "uuid");

CREATE INDEX IF NOT EXISTS "Ticket_accountId_status_idx" ON "Ticket"("accountId", "status");

CREATE INDEX IF NOT EXISTS "Ticket_accountId_source_idx" ON "Ticket"("accountId", "source");

CREATE INDEX IF NOT EXISTS "Ticket_accountId_endDate_idx" ON "Ticket"("accountId", "endDate");

CREATE INDEX IF NOT EXISTS "Ticket_accountId_createdAt_idx" ON "Ticket"("accountId", "createdAt");

CREATE INDEX IF NOT EXISTS "Scan_accountId_idx" ON "Scan"("accountId");

CREATE INDEX IF NOT EXISTS "Scan_deviceId_idx" ON "Scan"("deviceId");

CREATE INDEX IF NOT EXISTS "Scan_scanTime_idx" ON "Scan"("scanTime");

CREATE INDEX IF NOT EXISTS "Scan_code_idx" ON "Scan"("code");

CREATE INDEX IF NOT EXISTS "Scan_ticketId_idx" ON "Scan"("ticketId");

CREATE INDEX IF NOT EXISTS "Scan_accountId_scanTime_idx" ON "Scan"("accountId", "scanTime");

CREATE INDEX IF NOT EXISTS "Scan_accountId_scanTime_result_idx" ON "Scan"("accountId", "scanTime", "result");

CREATE INDEX IF NOT EXISTS "AccessArea_accountId_idx" ON "AccessArea"("accountId");

CREATE INDEX IF NOT EXISTS "AccessArea_parentId_idx" ON "AccessArea"("parentId");

CREATE INDEX IF NOT EXISTS "TicketArea_ticketId_idx" ON "TicketArea"("ticketId");

CREATE INDEX IF NOT EXISTS "TicketArea_accessAreaId_idx" ON "TicketArea"("accessAreaId");

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "TicketArea_ticketId_accessAreaId_key" ON "TicketArea"("ticketId", "accessAreaId");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'TicketArea_ticketId_accessAreaId_key nicht angelegt: doppelte Werte vorhanden';
END $$;

CREATE INDEX IF NOT EXISTS "Subscription_accountId_idx" ON "Subscription"("accountId");

CREATE INDEX IF NOT EXISTS "ServiceArea_serviceId_idx" ON "ServiceArea"("serviceId");

CREATE INDEX IF NOT EXISTS "ServiceArea_accessAreaId_idx" ON "ServiceArea"("accessAreaId");

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "ServiceArea_serviceId_accessAreaId_key" ON "ServiceArea"("serviceId", "accessAreaId");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'ServiceArea_serviceId_accessAreaId_key nicht angelegt: doppelte Werte vorhanden';
END $$;

CREATE INDEX IF NOT EXISTS "Service_accountId_idx" ON "Service"("accountId");

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "MonitorConfig_token_key" ON "MonitorConfig"("token");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'MonitorConfig_token_key nicht angelegt: doppelte Werte vorhanden';
END $$;

CREATE INDEX IF NOT EXISTS "MonitorConfig_accountId_idx" ON "MonitorConfig"("accountId");

CREATE INDEX IF NOT EXISTS "MonitorConfig_token_idx" ON "MonitorConfig"("token");

CREATE INDEX IF NOT EXISTS "TelegramConfig_accountId_idx" ON "TelegramConfig"("accountId");

CREATE INDEX IF NOT EXISTS "AnnyResourceLink_accountId_idx" ON "AnnyResourceLink"("accountId");

CREATE INDEX IF NOT EXISTS "AnnyResourceLink_accessAreaId_idx" ON "AnnyResourceLink"("accessAreaId");

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "AnnyResourceLink_accessAreaId_annyName_key" ON "AnnyResourceLink"("accessAreaId", "annyName");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'AnnyResourceLink_accessAreaId_annyName_key nicht angelegt: doppelte Werte vorhanden';
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Voucher_code_key" ON "Voucher"("code");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Voucher_code_key nicht angelegt: doppelte Werte vorhanden';
END $$;

CREATE INDEX IF NOT EXISTS "Voucher_accountId_idx" ON "Voucher"("accountId");

CREATE INDEX IF NOT EXISTS "Voucher_code_idx" ON "Voucher"("code");

CREATE INDEX IF NOT EXISTS "ApiConfig_accountId_idx" ON "ApiConfig"("accountId");

CREATE INDEX IF NOT EXISTS "ApiConfig_provider_idx" ON "ApiConfig"("provider");

CREATE INDEX IF NOT EXISTS "ApiConfig_accountId_provider_idx" ON "ApiConfig"("accountId", "provider");

CREATE INDEX IF NOT EXISTS "_AccessAreaToSubscription_B_index" ON "_AccessAreaToSubscription"("B");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Admin_accountId_fkey') THEN
    ALTER TABLE "Admin" ADD CONSTRAINT "Admin_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Admin_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Device_accountId_fkey') THEN
    ALTER TABLE "Device" ADD CONSTRAINT "Device_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Device_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_accountId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Ticket_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_accessAreaId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_accessAreaId_fkey" FOREIGN KEY ("accessAreaId") REFERENCES "AccessArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Ticket_accessAreaId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_subscriptionId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Ticket_subscriptionId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_serviceId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Ticket_serviceId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Scan_accountId_fkey') THEN
    ALTER TABLE "Scan" ADD CONSTRAINT "Scan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Scan_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Scan_ticketId_fkey') THEN
    ALTER TABLE "Scan" ADD CONSTRAINT "Scan_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Scan_ticketId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessArea_accountId_fkey') THEN
    ALTER TABLE "AccessArea" ADD CONSTRAINT "AccessArea_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'AccessArea_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessArea_parentId_fkey') THEN
    ALTER TABLE "AccessArea" ADD CONSTRAINT "AccessArea_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccessArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'AccessArea_parentId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketArea_ticketId_fkey') THEN
    ALTER TABLE "TicketArea" ADD CONSTRAINT "TicketArea_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'TicketArea_ticketId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketArea_accessAreaId_fkey') THEN
    ALTER TABLE "TicketArea" ADD CONSTRAINT "TicketArea_accessAreaId_fkey" FOREIGN KEY ("accessAreaId") REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'TicketArea_accessAreaId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subscription_accountId_fkey') THEN
    ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Subscription_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceArea_serviceId_fkey') THEN
    ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'ServiceArea_serviceId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceArea_accessAreaId_fkey') THEN
    ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_accessAreaId_fkey" FOREIGN KEY ("accessAreaId") REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'ServiceArea_accessAreaId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Service_accountId_fkey') THEN
    ALTER TABLE "Service" ADD CONSTRAINT "Service_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Service_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MonitorConfig_accountId_fkey') THEN
    ALTER TABLE "MonitorConfig" ADD CONSTRAINT "MonitorConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'MonitorConfig_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramConfig_accountId_fkey') THEN
    ALTER TABLE "TelegramConfig" ADD CONSTRAINT "TelegramConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'TelegramConfig_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnnyResourceLink_accessAreaId_fkey') THEN
    ALTER TABLE "AnnyResourceLink" ADD CONSTRAINT "AnnyResourceLink_accessAreaId_fkey" FOREIGN KEY ("accessAreaId") REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'AnnyResourceLink_accessAreaId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Voucher_accountId_fkey') THEN
    ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Voucher_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiConfig_accountId_fkey') THEN
    ALTER TABLE "ApiConfig" ADD CONSTRAINT "ApiConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'ApiConfig_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClimateSample_accountId_fkey') THEN
    ALTER TABLE "ClimateSample" ADD CONSTRAINT "ClimateSample_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'ClimateSample_accountId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClimateSample_deviceId_fkey') THEN
    ALTER TABLE "ClimateSample" ADD CONSTRAINT "ClimateSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'ClimateSample_deviceId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClimateSample_roomId_fkey') THEN
    ALTER TABLE "ClimateSample" ADD CONSTRAINT "ClimateSample_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "KeyRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'ClimateSample_roomId_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_AccessAreaToSubscription_A_fkey') THEN
    ALTER TABLE "_AccessAreaToSubscription" ADD CONSTRAINT "_AccessAreaToSubscription_A_fkey" FOREIGN KEY ("A") REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE '_AccessAreaToSubscription_A_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_AccessAreaToSubscription_B_fkey') THEN
    ALTER TABLE "_AccessAreaToSubscription" ADD CONSTRAINT "_AccessAreaToSubscription_B_fkey" FOREIGN KEY ("B") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE '_AccessAreaToSubscription_B_fkey nicht angelegt: verwaiste Zeilen vorhanden';
END $$;

-- Zwei Indizes, die fruehere Migrationen anlegen und die jetzt auch im Schema
-- stehen; hier nur als Absicherung, falls sie in einer Datenbank fehlen.
CREATE INDEX IF NOT EXISTS "AllowedVehicle_doorbirdCameraId_idx" ON "AllowedVehicle"("doorbirdCameraId");
CREATE INDEX IF NOT EXISTS "Device_gardenaConfigId_idx" ON "Device"("gardenaConfigId");
