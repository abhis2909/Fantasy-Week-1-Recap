-- CreateTable
CREATE TABLE "PlayerGameLog" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameDate" TIMESTAMP(3) NOT NULL,
    "opponent" TEXT,
    "values" JSONB NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'NHL_SYNC',

    CONSTRAINT "PlayerGameLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerGameLog_playerId_gameDate_key" ON "PlayerGameLog"("playerId", "gameDate");

-- AddForeignKey
ALTER TABLE "PlayerGameLog" ADD CONSTRAINT "PlayerGameLog_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
