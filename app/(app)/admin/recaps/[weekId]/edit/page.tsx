import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { prisma } from "@/lib/prisma";
import {
  generateRecapDraft,
  saveRecapSectionEdits,
  publishRecap,
  unpublishRecap,
} from "@/lib/recap/generate";
import { SECTION_TITLES, type SectionType } from "@/lib/recap/sectionTypes";

export default async function EditRecapPage({
  params,
}: PageProps<"/admin/recaps/[weekId]/edit">) {
  const { weekId } = await params;
  const week = await prisma.week.findUnique({ where: { id: weekId } });
  if (!week) notFound();

  const article = await prisma.recapArticle.findUnique({
    where: { weekId },
    include: { sections: { orderBy: { order: "asc" } } },
  });

  async function generateDraft() {
    "use server";
    await generateRecapDraft(weekId);
    revalidatePath(`/admin/recaps/${weekId}/edit`);
  }

  async function saveEdits(formData: FormData) {
    "use server";
    if (!article) return;
    const edits = article.sections.map((s) => ({
      sectionId: s.id,
      title: (formData.get(`title-${s.id}`) as string) ?? s.title,
      body: (formData.get(`body-${s.id}`) as string) ?? s.body,
    }));
    await saveRecapSectionEdits(article.id, edits);
    revalidatePath(`/admin/recaps/${weekId}/edit`);
  }

  async function togglePublish() {
    "use server";
    if (!article) return;
    if (article.isPublished) await unpublishRecap(article.id);
    else await publishRecap(article.id);
    revalidatePath(`/admin/recaps/${weekId}/edit`);
    revalidatePath(`/recaps/${weekId}`);
    revalidatePath("/recaps");
  }

  return (
    <>
      <PageHeader
        title={`Edit Recap — Week ${week.number}`}
        subtitle={
          article?.isPublished
            ? "Live on the site right now."
            : article
              ? "Draft — not visible to the league yet."
              : "No draft generated yet."
        }
      />

      <SectionCard title="Generation">
        <div className="flex flex-wrap items-center gap-3">
          <form action={generateDraft}>
            <button
              type="submit"
              className="rounded-lg bg-red px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              {article ? "Regenerate draft" : "Generate draft"}
            </button>
          </form>
          {article && (
            <form action={togglePublish}>
              <button
                type="submit"
                className="rounded-lg bg-blue px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                {article.isPublished ? "Unpublish" : "Publish"}
              </button>
            </form>
          )}
          {article?.isPublished && (
            <Link href={`/recaps/${weekId}`} className="text-sm text-cream/80 underline">
              View live page
            </Link>
          )}
        </div>
        <p className="mt-3 text-xs text-cream/60">
          Regenerating replaces every section below and un-publishes the article — review
          and hit Publish again when it&apos;s ready.
        </p>
      </SectionCard>

      {article && (
        <SectionCard title="Sections">
          <form action={saveEdits} className="flex flex-col gap-6">
            {article.sections.map((s) => (
              <div key={s.id} className="rounded-lg bg-white/5 p-4">
                <label className="mb-1 block text-xs tracking-wide text-cream/60 uppercase">
                  {SECTION_TITLES[s.type as SectionType] ?? s.type}
                </label>
                <input
                  name={`title-${s.id}`}
                  defaultValue={s.title}
                  className="mb-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 font-heading text-lg text-white focus:border-red focus:outline-none"
                />
                <textarea
                  name={`body-${s.id}`}
                  defaultValue={s.body}
                  rows={4}
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-red focus:outline-none"
                />
              </div>
            ))}
            <button
              type="submit"
              className="w-fit rounded-lg bg-red px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Save edits
            </button>
          </form>
        </SectionCard>
      )}
    </>
  );
}
