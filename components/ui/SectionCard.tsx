import type { ReactNode } from "react";

/**
 * The navy card-with-red-border container the mockup used for every major
 * block on the page (Team of the Week, Matchup Highlights, etc). Reused
 * across standings, TOTW, transactions, and the recap article — not just
 * the recap page it was originally designed for.
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
      className={`mx-auto my-8 max-w-4xl rounded-2xl border-2 border-red bg-navy p-6 text-cream shadow-md sm:p-8 ${className}`}
    >
      {title && (
        <h2 className="mb-5 inline-block border-b-2 border-red pb-1.5 font-heading text-2xl tracking-wide text-white sm:text-3xl">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
