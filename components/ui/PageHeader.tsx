export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="border-t-[6px] border-b-[6px] border-t-red border-b-blue bg-white px-5 py-8 text-center text-navy-ink">
      <h1 className="font-heading text-3xl tracking-wide text-navy-deep sm:text-4xl">
        {title}
      </h1>
      {subtitle && <p className="mt-2 text-neutral-600">{subtitle}</p>}
    </header>
  );
}
