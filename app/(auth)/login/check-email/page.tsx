import { SectionCard } from "@/components/ui/SectionCard";
import { PageHeader } from "@/components/ui/PageHeader";

export default function CheckEmailPage() {
  return (
    <>
      <PageHeader title="🏒 Slapshot City Fantasy Hockey League" />
      <SectionCard title="Check your email">
        <p>
          We sent you a sign-in link. Open it on this device to get into the
          league site. Links expire after 24 hours.
        </p>
        <p className="mt-3 text-sm text-cream/70">
          Running locally without a Resend API key configured? The link was
          printed to the dev server&apos;s console instead of sent.
        </p>
      </SectionCard>
    </>
  );
}
