-- Basis-Migration: Kerntabellen und Enums, die vor Einfuehrung der
-- Migrationen per `prisma db push` entstanden sind und deshalb in keiner
-- Migration vorkamen. Damit laesst sich eine leere Datenbank vollstaendig
-- aus prisma/migrations aufbauen.
--
-- Auf einer bestehenden Datenbank ist jede Anweisung ein No-op
-- (IF NOT EXISTS bzw. abgefangenes duplicate_object). Die Tabellen stehen
-- hier in ihrer Ursprungsform: Spalten, die spaetere Migrationen ergaenzen,
-- fehlen absichtlich. Indizes und Fremdschluessel dieser Tabellen legt
-- 20261109120000_ticket_date_indexes_scan_history an.

DO $$ BEGIN
  CREATE TYPE "AdminRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeviceType" AS ENUM ('RASPBERRY_PI', 'SHELLY', 'NUKI_SMARTLOCK', 'GARDENA_VALVE', 'AUDIO_PLAYER', 'LOQED_SMARTLOCK', 'HUE_LIGHT', 'MAMMOTION_MOWER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeviceCategory" AS ENUM ('DREHKREUZ', 'TUER', 'SENSOR', 'SCHALTER', 'BELEUCHTUNG', 'AUDIO', 'MARKISE', 'ROLLTOR', 'TASTER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'REDEEMED', 'INVALID', 'PROTECTED', 'PAUSED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ValidityType" AS ENUM ('DATE_RANGE', 'TIME_SLOT', 'DURATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ScanResult" AS ENUM ('GRANTED', 'DENIED', 'PROTECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ApiProvider" AS ENUM ('ANNY', 'WAKESYS', 'BINARYTEC', 'EMP_CONTROL', 'SHELLY', 'NUKI', 'GARDENA', 'LOQED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ShellyAction" AS ENUM ('ON', 'OFF', 'TOGGLE', 'OPEN', 'CLOSE', 'STOP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Altlasten (nur leere Datenbank): diese Objekte gab es frueher, spaetere
-- Migrationen aendern sie noch und entfernen sie dann. Auf einer bestehenden
-- Datenbank (Account-Tabelle vorhanden) werden sie nicht wieder angelegt.
DO $legacy$ BEGIN
  IF to_regclass('public."Account"') IS NULL THEN
    CREATE TYPE "AutomationTrigger" AS ENUM ('SCHEDULE', 'SUNRISE', 'SUNSET');
    CREATE TABLE "ShellyGroup" (
        "id" SERIAL NOT NULL,
        "accountId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ShellyGroup_pkey" PRIMARY KEY ("id")
    );
    CREATE TABLE "ShellyGroupMember" (
        "id" SERIAL NOT NULL,
        "groupId" INTEGER NOT NULL,
        "deviceId" INTEGER NOT NULL,
        "action" "ShellyAction" NOT NULL DEFAULT 'ON',
        "timerSeconds" INTEGER,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "ShellyGroupMember_pkey" PRIMARY KEY ("id")
    );
    CREATE TABLE "ShellyAutomation" (
        "id" SERIAL NOT NULL,
        "accountId" INTEGER NOT NULL,
        "groupId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "trigger" "AutomationTrigger" NOT NULL,
        "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
        "timeOfDay" TEXT,
        "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
        "lastRunAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ShellyAutomation_pkey" PRIMARY KEY ("id")
    );
    CREATE TABLE "ShellyAutomationRun" (
        "id" SERIAL NOT NULL,
        "automationId" INTEGER,
        "groupId" INTEGER,
        "accountId" INTEGER NOT NULL,
        "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "triggerKind" TEXT NOT NULL,
        "success" BOOLEAN NOT NULL,
        "details" JSONB,
        "durationMs" INTEGER,
        "errorMessage" TEXT,
        CONSTRAINT "ShellyAutomationRun_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $legacy$;

CREATE TABLE IF NOT EXISTS "Account" (
    "id" SERIAL NOT NULL,
    "subdomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Admin" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'USER',
    "lastLogin" TIMESTAMP(3),
    "accountId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Device" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "category" "DeviceCategory",
    "ipAddress" TEXT,
    "shellyId" TEXT,
    "shellyAuthKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "task" INTEGER NOT NULL DEFAULT 0,
    "accessIn" INTEGER,
    "accessOut" INTEGER,
    "allowReentry" BOOLEAN NOT NULL DEFAULT false,
    "firmware" TEXT,
    "systemInfo" JSONB,
    "lastUpdate" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "schedule" JSONB,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "qrCode" TEXT,
    "rfidCode" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "validityType" "ValidityType" NOT NULL DEFAULT 'DATE_RANGE',
    "slotStart" TEXT,
    "slotEnd" TEXT,
    "validityDurationMinutes" INTEGER,
    "firstScanAt" TIMESTAMP(3),
    "accessAreaId" INTEGER,
    "subscriptionId" INTEGER,
    "serviceId" INTEGER,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "version" INTEGER NOT NULL DEFAULT 0,
    "uuid" TEXT,
    "barcode" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "birthDate" TIMESTAMP(3),
    "ticketTypeName" TEXT,
    "profileImage" TEXT,
    "extras" JSONB,
    "source" "ApiProvider",
    "annyBookingId" TEXT,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Scan" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "deviceId" INTEGER,
    "scanTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "ScanResult" NOT NULL,
    "ticketId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccessArea" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "allowReentry" BOOLEAN NOT NULL DEFAULT false,
    "personLimit" INTEGER,
    "showOnDashboard" BOOLEAN NOT NULL DEFAULT true,
    "openingHours" TEXT,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TicketArea" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "accessAreaId" INTEGER NOT NULL,
    CONSTRAINT "TicketArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Subscription" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "annyNames" TEXT,
    "defaultValidityType" "ValidityType",
    "defaultStartDate" TIMESTAMP(3),
    "defaultEndDate" TIMESTAMP(3),
    "defaultSlotStart" TEXT,
    "defaultSlotEnd" TEXT,
    "defaultValidityDurationMinutes" INTEGER,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requiresRfid" BOOLEAN NOT NULL DEFAULT false,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ServiceArea" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "accessAreaId" INTEGER NOT NULL,
    "defaultValidityType" "ValidityType",
    "defaultStartDate" TIMESTAMP(3),
    "defaultEndDate" TIMESTAMP(3),
    "defaultSlotStart" TEXT,
    "defaultSlotEnd" TEXT,
    "defaultValidityDurationMinutes" INTEGER,
    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Service" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "annyNames" TEXT,
    "defaultValidityType" "ValidityType",
    "defaultStartDate" TIMESTAMP(3),
    "defaultEndDate" TIMESTAMP(3),
    "defaultSlotStart" TEXT,
    "defaultSlotEnd" TEXT,
    "defaultValidityDurationMinutes" INTEGER,
    "allowManualCheckin" BOOLEAN NOT NULL DEFAULT true,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requiresRfid" BOOLEAN NOT NULL DEFAULT false,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MonitorConfig" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MONITOR',
    "deviceIds" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitorConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TelegramConfig" (
    "id" SERIAL NOT NULL,
    "botToken" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dailyReport" BOOLEAN NOT NULL DEFAULT true,
    "dailyReportTime" TEXT NOT NULL DEFAULT '20:00',
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnnyResourceLink" (
    "id" SERIAL NOT NULL,
    "accessAreaId" INTEGER NOT NULL,
    "annyResourceId" TEXT NOT NULL,
    "annyName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "splitSlots" BOOLEAN NOT NULL DEFAULT false,
    "bookingInterval" INTEGER,
    "priceLabel" TEXT,
    "priceLabelWeekend" TEXT,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnnyResourceLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Voucher" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "ticketTypeName" TEXT,
    "serviceId" INTEGER,
    "accessAreaId" INTEGER,
    "validityType" "ValidityType" NOT NULL DEFAULT 'DATE_RANGE',
    "validityDurationMinutes" INTEGER,
    "sourceTicketId" INTEGER,
    "redeemedAt" TIMESTAMP(3),
    "redeemedTicketId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ApiConfig" (
    "id" SERIAL NOT NULL,
    "provider" "ApiProvider" NOT NULL,
    "token" TEXT NOT NULL,
    "eventId" TEXT,
    "baseUrl" TEXT,
    "extraConfig" TEXT,
    "lastUpdate" TIMESTAMP(3),
    "lastPostUpdate" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "_AccessAreaToSubscription" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_AccessAreaToSubscription_AB_pkey" PRIMARY KEY ("A","B")
);
