CREATE TABLE IF NOT EXISTS "RoomMotionEvent" (
  "id" SERIAL NOT NULL,
  "accountId" INTEGER NOT NULL,
  "roomId" INTEGER NOT NULL,
  "deviceId" INTEGER NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomMotionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoomMotionEvent_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMotionEvent_roomId_fkey" FOREIGN KEY ("roomId")
    REFERENCES "KeyRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMotionEvent_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RoomMotionEvent_deviceId_at_key" ON "RoomMotionEvent"("deviceId", "at");
CREATE INDEX IF NOT EXISTS "RoomMotionEvent_accountId_roomId_at_idx" ON "RoomMotionEvent"("accountId", "roomId", "at");
