import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";
import { RatingForm } from "@/components/transactions/RatingForm";
import { TYPE_LABELS, DIRECTION_LABELS } from "@/components/transactions/transactionLabels";
import { getTransactionDetail, averageRating } from "@/lib/transactions";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function TransactionDetailPage({
  params,
}: PageProps<"/transactions/[id]">) {
  const { id } = await params;
  const tx = await getTransactionDetail(id);
  if (!tx) notFound();

  const session = await auth();
  const myTeam = session
    ? await prisma.team.findUnique({ where: { managerId: session.user.id } })
    : null;
  const isInvolved =
    !!myTeam &&
    (myTeam.id === tx.initiatingTeamId || myTeam.id === tx.counterpartyTeamId);
  const myExistingRating = session
    ? tx.ratings.find((r) => r.raterId === session.user.id)
    : undefined;
  const avg = averageRating(tx.ratings);

  async function submitRating(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session) return;

    const currentTx = await prisma.transaction.findUnique({ where: { id } });
    if (!currentTx) return;
    const raterTeam = await prisma.team.findUnique({
      where: { managerId: session.user.id },
    });
    if (
      raterTeam &&
      (raterTeam.id === currentTx.initiatingTeamId ||
        raterTeam.id === currentTx.counterpartyTeamId)
    ) {
      return; // can't rate your own move
    }

    const score = Number(formData.get("score"));
    if (!Number.isInteger(score) || score < 1 || score > 10) return;
    const comment = formData.get("comment")?.toString().trim() || null;

    await prisma.transactionRating.upsert({
      where: {
        transactionId_raterId: { transactionId: id, raterId: session.user.id },
      },
      create: { transactionId: id, raterId: session.user.id, score, comment },
      update: { score, comment },
    });
    revalidatePath(`/transactions/${id}`);
    revalidatePath("/transactions");
    redirect(`/transactions/${id}`);
  }

  return (
    <>
      <PageHeader
        title={TYPE_LABELS[tx.type]}
        subtitle={`Week ${tx.week.number} — ${tx.initiatingTeam.name}${
          tx.counterpartyTeam ? ` ↔ ${tx.counterpartyTeam.name}` : ""
        }`}
      />
      <SectionCard title="What happened">
        <ul className="mb-4 space-y-1 text-cream/90">
          {tx.playersInvolved.map((tp) => (
            <li key={tp.id}>
              <span className="font-semibold text-white">
                {DIRECTION_LABELS[tp.direction]}:
              </span>{" "}
              {tp.player.fullName} ({tp.player.primaryPosition})
            </li>
          ))}
        </ul>

        <div className="mb-6 rounded-lg bg-white/5 px-4 py-3">
          <p className="font-heading text-2xl text-white">
            {avg !== null ? `${avg} / 10` : "No ratings yet"}
          </p>
          <p className="text-xs text-cream/60">
            {tx.ratings.length} rating{tx.ratings.length === 1 ? "" : "s"} from the
            league
          </p>
        </div>

        {!session ? null : isInvolved ? (
          <p className="text-sm text-cream/70">
            You can&apos;t rate your own transaction. Everyone else can, though.
          </p>
        ) : (
          <RatingForm
            action={submitRating}
            existingScore={myExistingRating?.score}
            existingComment={myExistingRating?.comment}
          />
        )}

        {tx.ratings.length > 0 && (
          <div className="mt-6 flex flex-col gap-3">
            {tx.ratings.map((r) => (
              <HighlightBox key={r.id} title={`${r.rater.name} — ${r.score}/10`}>
                {r.comment || <span className="text-neutral-500">No comment.</span>}
              </HighlightBox>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
