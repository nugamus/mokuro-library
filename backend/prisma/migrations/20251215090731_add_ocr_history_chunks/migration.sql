-- AlterTable
ALTER TABLE "Volume" ADD COLUMN "headPatchId" TEXT;

-- CreateTable
CREATE TABLE "HistoryChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "volumeId" TEXT NOT NULL,
    "previousChunkId" TEXT,
    "startPatchId" TEXT NOT NULL,
    "endPatchId" TEXT NOT NULL,
    "payload" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoryChunk_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HistoryChunk_volumeId_endPatchId_idx" ON "HistoryChunk"("volumeId", "endPatchId");
