export function QuoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-r-4 border-l-4 border-blue bg-white px-6 py-6 text-center text-lg italic text-neutral-800 shadow-sm">
      {children}
    </div>
  );
}
