-- MCP-Schnittstelle: Zugangstoken fuer KI-Assistenten (nur der Hash wird gespeichert).
CREATE TABLE IF NOT EXISTS "McpToken" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "hint" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'read',
  "createdBy" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpToken_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "McpToken_tokenHash_key" ON "McpToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "McpToken_accountId_idx" ON "McpToken"("accountId");
