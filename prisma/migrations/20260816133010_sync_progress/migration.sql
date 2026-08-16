-- CreateTable
CREATE TABLE "SyncProgress" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncProgress_key_key" ON "SyncProgress"("key");
