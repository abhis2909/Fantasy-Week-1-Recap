-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "nhlTeamAbbrev" TEXT;

-- CreateTable
CREATE TABLE "PlayerSeasonRating" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "categoryScores" JSONB NOT NULL,
    "currentSeasonWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSeasonRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonRating_playerId_key" ON "PlayerSeasonRating"("playerId");

-- AddForeignKey
ALTER TABLE "PlayerSeasonRating" ADD CONSTRAINT "PlayerSeasonRating_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
