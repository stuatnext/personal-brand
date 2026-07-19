import { PageHeader } from "@/components/ui";
import { ProcessingReport } from "./report";

export const dynamic = "force-dynamic";

export default async function IngestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        section="Intelligence / Processing report"
        title="Processing report"
        meta="Stage progress, what was extracted, and what was set aside. Every item links back to exact offsets in the preserved raw input."
      />
      <ProcessingReport ingestionId={id} />
    </>
  );
}
