"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Fades/slides its children in once they scroll into view. Used to give the
 * site a "dynamic as you scroll" feel — every major section and card enters
 * the page instead of just appearing. Respects prefers-reduced-motion by
 * skipping straight to the visible state.
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** Stagger delay for grids of cards — pass e.g. `index * 60`. */
  delayMs?: number;
  as?: "div" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // Defer so this doesn't synchronously cascade off the mount effect.
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }

    // threshold is a *ratio of the target's own area* — for a large section
    // (e.g. a roster grid of 70+ cards) even a fully-scrolled-to view only
    // ever covers a small fraction of its total height, so anything above
    // ~0.1 can simply never fire. Use threshold 0 (any pixel visible)
    // instead, with no shrunk rootMargin — a negative bottom margin would
    // make the last row of a grid sitting at the very end of the page
    // (nothing left to scroll) permanently unreachable, since the trigger
    // zone can end up entirely below what the page can ever scroll to.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
      className={`transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
