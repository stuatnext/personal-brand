import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { theses } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui";
import { ThesisDetail } from "./detail";

export const dynamic = "force-dynamic";

export default async function ThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [thesis] = await database.select().from(theses).where(eq(theses.id, id));
  if (!thesis) notFound();
  return (
    <>
      <PageHeader section="Theses / Detail" title={thesis.statement} meta={`status ${thesis.status.replace(/_/g, " ")}`} />
      <ThesisDetail thesisId={id} />
    </>
  );
}
