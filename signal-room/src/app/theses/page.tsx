import { PageHeader } from "@/components/ui";
import { listTheses } from "@/lib/theses";
import { ThesesView } from "./theses-view";

export const dynamic = "force-dynamic";

export default async function ThesesPage() {
  const theses = await listTheses();
  return (
    <>
      <PageHeader
        section="Theses"
        title="Positions Stuart is holding"
        meta="The pipeline suggests claim evidence for open theses; you confirm it, set its stance, and move the confidence yourself. The system counts evidence; it does not pretend to forecast."
      />
      <ThesesView initialTheses={theses} />
    </>
  );
}
