ALTER TABLE "NetworkDevice" ADD COLUMN IF NOT EXISTS "keyRoomId" INTEGER;
ALTER TABLE "NetworkClient" ADD COLUMN IF NOT EXISTS "keyRoomId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "NetworkDevice" ADD CONSTRAINT "NetworkDevice_keyRoomId_fkey" FOREIGN KEY ("keyRoomId") REFERENCES "KeyRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "NetworkClient" ADD CONSTRAINT "NetworkClient_keyRoomId_fkey" FOREIGN KEY ("keyRoomId") REFERENCES "KeyRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "NetworkDevice_keyRoomId_idx" ON "NetworkDevice"("keyRoomId");
CREATE INDEX IF NOT EXISTS "NetworkClient_keyRoomId_idx" ON "NetworkClient"("keyRoomId");
