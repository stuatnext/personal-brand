import { PageHeader } from "@/components/ui";
import { ArchiveSearch } from "./search";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  return (
    <>
      <PageHeader
        section="Archive"
        title="Everything, searchable"
        meta="All opportunities across all ingestions: queued, saved, used, ignored and the ones that never made the cut."
      />
      <ArchiveSearch />
    </>
  );
}
