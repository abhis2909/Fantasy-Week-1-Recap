import type { ReactNode } from "react";

/**
 * The navy card-with-gold-border container used for every major block on
 * the page (Team of the Week, Matchup Highlights, etc). Reused across
 * standings, TOTW, transactions, and the recap article.
 */
export function SectionCard({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`mx-auto my-8 max-w-4xl rounded-2xl border border-gold/40 bg-navy p-6 text-cream shadow-lg shadow-black/20 sm:p-8 ${className}`}
    >
      {title && (
        <h2 className="mb-5 inline-block border-b-2 border-gold pb-1.5 font-heading text-2xl tracking-wide text-gold uppercase sm:text-3xl">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
