import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        section="Settings"
        title="Settings"
        meta="Themes steer scoring towards what Stuart is watching. Weights tune how the queue ranks. Scores are opinions with editable weights."
      />
      <SettingsForm />
    </>
  );
}
