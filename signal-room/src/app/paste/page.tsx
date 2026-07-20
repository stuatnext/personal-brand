import { PageHeader } from "@/components/ui";
import { PasteForm } from "./paste-form";

export const dynamic = "force-dynamic";

export default function PastePage() {
  return (
    <>
      <PageHeader
        section="Ingest"
        title="Paste the mess. Cleaning is not required."
        meta="Select-all page dumps, navigation litter, duplicates, broken formatting: all fine. The original is preserved exactly before anything touches it."
      />
      <PasteForm />
    </>
  );
}
