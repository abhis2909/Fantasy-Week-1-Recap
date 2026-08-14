import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import { getCurrentSeason } from "@/lib/currentSeason";
import { listTransactions } from "@/lib/transactions";

export default async function TransactionsPage() {
  const season = await getCurrentSeason();
  const transactions = await listTransactions(season.id);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Adds, drops, and trades — rate your league mates' decisions out of 10."
      />
      <SectionCard title="Transaction Log">
        {transactions.length === 0 ? (
          <p className="text-cream/80">No transactions logged yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {transactions.map((tx) => (
              <TransactionCard key={tx.id} tx={tx} />
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
