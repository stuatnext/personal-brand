import { desc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { opportunities, recommendations, ingestions } from "../src/lib/db/schema";

async function main() {
  const database = await db();
  const recs = await database
    .select({
      position: recommendations.position,
      action: recommendations.primaryAction,
      title: opportunities.title,
      score: opportunities.overallScore,
      rationale: opportunities.rationale,
      ingestion: ingestions.title,
    })
    .from(recommendations)
    .innerJoin(opportunities, eq(recommendations.opportunityId, opportunities.id))
    .innerJoin(ingestions, eq(recommendations.ingestionId, ingestions.id))
    .orderBy(desc(opportunities.overallScore));
  for (const r of recs) {
    console.log(`[${r.score}] ${r.action.toUpperCase()} :: ${r.title?.slice(0, 90)}`);
    console.log(`     from: ${r.ingestion?.slice(0, 60)}`);
    console.log(`     why: ${r.rationale?.slice(0, 140)}\n`);
  }
}
main().then(() => process.exit(0));
