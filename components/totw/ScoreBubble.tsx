export function ScoreBubble({ value }: { value: number | string }) {
  return (
    <div className="absolute -top-4 -right-3 rounded-full bg-red px-3.5 py-3.5 text-sm font-bold text-white shadow-md">
      {value}
    </div>
  );
}
