-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "counterpartyTeamId" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_counterpartyTeamId_fkey" FOREIGN KEY ("counterpartyTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
