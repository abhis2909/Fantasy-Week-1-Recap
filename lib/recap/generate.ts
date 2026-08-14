import { prisma } from "@/lib/prisma";
import { buildWeeklyStatsPayload } from "@/lib/recap/payload";
import { generateRecapWithClaude } from "@/lib/recap/claude";
import { generateTemplateRecap } from "@/lib/recap/templateGenerator";

const PROMPT_VERSION = "v1";

/**
 * Builds the week's stats payload, generates recap prose (Claude if
 * ANTHROPIC_API_KEY is set, the deterministic template otherwise), and
 * writes it as an unpublished draft — replacing any previous draft/sections
 * for this week. Regenerating always un-publishes; the commissioner has to
 * review and hit Publish again, so a bad regeneration can never silently
 * overwrite what's live.
 */
export async function generateRecapDraft(weekId: string) {
  const payload = await buildWeeklyStatsPayload(weekId);
  const claudeResult = await generateRecapWithClaude(payload);
  const { output, model } = claudeResult
    ? { output: claudeResult.output, model: claudeResult.model }
    : { output: generateTemplateRecap(payload), model: null };

  // Defensive: the model is asked for at most one CLUTCH/CLOWN/QUOTE, but
  // nothing enforces that structurally — dedupe by type (first wins) so a
  // slip can't crash on RecapSection's (articleId, type) unique constraint.
  const seen = new Set<string>();
  const sections = output.sections.filter((s) => {
    if (seen.has(s.type)) return false;
    seen.add(s.type);
    return true;
  });

  await prisma.recapArticle.upsert({
    where: { weekId },
    create: {
      weekId,
      title: output.title,
      generatedByModel: model,
      promptVersion: PROMPT_VERSION,
      sections: {
        create: sections.map((s, i) => ({ type: s.type, order: i, title: s.title, body: s.body })),
      },
    },
    update: {
      title: output.title,
      generatedByModel: model,
      promptVersion: PROMPT_VERSION,
      isPublished: false,
      publishedAt: null,
      sections: {
        deleteMany: {},
        create: sections.map((s, i) => ({ type: s.type, order: i, title: s.title, body: s.body })),
      },
    },
  });

  return prisma.recapArticle.findUniqueOrThrow({
    where: { weekId },
    include: { sections: { orderBy: { order: "asc" } } },
  });
}

export async function saveRecapSectionEdits(
  articleId: string,
  edits: { sectionId: string; title: string; body: string }[]
) {
  await prisma.$transaction(
    edits.map((e) =>
      prisma.recapSection.update({
        where: { id: e.sectionId },
        data: { title: e.title, body: e.body },
      })
    )
  );
  return prisma.recapArticle.update({ where: { id: articleId }, data: {} });
}

export async function publishRecap(articleId: string) {
  return prisma.recapArticle.update({
    where: { id: articleId },
    data: { isPublished: true, publishedAt: new Date() },
  });
}

export async function unpublishRecap(articleId: string) {
  return prisma.recapArticle.update({
    where: { id: articleId },
    data: { isPublished: false, publishedAt: null },
  });
}
