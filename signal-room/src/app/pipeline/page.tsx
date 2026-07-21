import { getPipeline } from "@/lib/graph";
import { PageHeader } from "@/components/ui";
import { PipelineView } from "./pipeline-view";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { lanes, totalsByState } = await getPipeline();
  const total = lanes.reduce((s, l) => s + l.rows.length, 0);

  return (
    <>
      <PageHeader
        section="Relationships"
        title="Outreach pipeline"
        meta={`${total} prospect(s) across ${lanes.length} lane(s) · states are Stuart's record of what HE did; nothing here sends`}
      />
      <PipelineView lanes={lanes} totalsByState={totalsByState} />
      <p className="mt-6 px-1 text-[11.5px] leading-relaxed text-[--color-dim]">
        Prospects land here when Stuart uses a lead opportunity. The system moves a card only as far
        as <span className="text-[--color-mut]">drafted</span> (a DM/email draft exists). Everything
        after that records an action Stuart took by hand, outside the system: he sends, this remembers.
        Every state change is audit-logged.
      </p>
    </>
  );
}
