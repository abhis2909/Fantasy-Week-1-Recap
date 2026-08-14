import { prisma } from "@/lib/prisma";

export async function listTransactions(seasonId: string) {
  const transactions = await prisma.transaction.findMany({
    where: { week: { seasonId } },
    orderBy: { timestamp: "desc" },
    include: {
      week: true,
      initiatingTeam: true,
      counterpartyTeam: true,
      playersInvolved: { include: { player: true } },
      ratings: true,
    },
  });

  return transactions.map((tx) => {
    const ratingCount = tx.ratings.length;
    const avgRating =
      ratingCount === 0
        ? null
        : Math.round(
            (tx.ratings.reduce((sum, r) => sum + r.score, 0) / ratingCount) * 10
          ) / 10;
    return { ...tx, avgRating, ratingCount };
  });
}

export async function getTransactionDetail(id: string) {
  return prisma.transaction.findUnique({
    where: { id },
    include: {
      week: true,
      initiatingTeam: true,
      counterpartyTeam: true,
      playersInvolved: { include: { player: true } },
      ratings: { include: { rater: true }, orderBy: { createdAt: "desc" } },
    },
  });
}

export function averageRating(ratings: { score: number }[]): number | null {
  if (ratings.length === 0) return null;
  return (
    Math.round((ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length) * 10) /
    10
  );
}
