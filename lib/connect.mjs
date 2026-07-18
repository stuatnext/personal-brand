// lib/connect.mjs — connect the dots for a post idea.
//
// An insight models the entities it touches (relatedCompanies / relatedContacts)
// and leads link back to companies, contacts and the insight that surfaced them,
// but those links sit mostly empty, so the ideas bank turns an insight into a
// post idea with no idea WHO or WHAT it connects to. This resolves the dots at
// read time: the companies and contacts named in the insight, the people who
// sit at those companies, the contacts relevant by a shared lane, and the open
// leads tied to any of them. A floating insight becomes "here is who and what
// this post touches", which is what makes a personal-brand post land and travel.
//
// Pure — pass the collections in (so it is trivially testable and never reads
// real data itself). It NEVER invents a connection: companies/contacts come from
// their own id links first, then a whole-word name match in the insight text;
// lane-overlap contacts are a softer signal and are labelled separately.

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const tok = (s) => norm(String(s || "").replace(/[^\p{L}\p{N}]+/gu, " "));

// Does `text` contain `name` as a whole word / contiguous phrase? Names shorter
// than 4 chars are never scanned (too collision-prone to assert as a link).
export function nameInText(text, name) {
  const n = tok(name);
  if (!n || n.length < 4) return false;
  return (" " + tok(text) + " ").includes(" " + n + " ");
}

const ACTIVE_LEAD = (ld) => !["converted", "dropped", "archived"].includes(String(ld && ld.status || ""));

// Resolve everything an insight connects to. Returns plain arrays + a one-line
// summary for the idea rationale.
export function connectInsight(insight, { companies = [], contacts = [], leads = [] } = {}) {
  const empty = { companies: [], contacts: [], laneContacts: [], leads: [], line: "" };
  if (!insight) return empty;
  const text = `${insight.title || ""} ${insight.raw || ""} ${insight.distilled || ""}`;
  const byId = (arr, id) => arr.find((x) => x.id === id);

  // Companies: explicit id links first, then whole-word name matches in the text.
  const compIds = new Set((insight.relatedCompanies || []).filter(Boolean));
  for (const c of companies) if (c.name && !compIds.has(c.id) && nameInText(text, c.name)) compIds.add(c.id);
  const cos = [...compIds].map((id) => byId(companies, id)).filter(Boolean)
    .map((c) => ({ id: c.id, name: c.name, industry: c.industry || "" }));

  // Contacts: explicit id links + name matches + anyone at a connected company.
  const conIds = new Set((insight.relatedContacts || []).filter(Boolean));
  for (const p of contacts) {
    if (conIds.has(p.id)) continue;
    if ((p.name && nameInText(text, p.name)) || (p.companyId && compIds.has(p.companyId))) conIds.add(p.id);
  }
  const cons = [...conIds].map((id) => byId(contacts, id)).filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, company: p.company || "", role: p.role || "", doNotContact: !!p.doNotContact }));

  // Contacts relevant by a shared lane — a softer "who might care about this
  // post" signal, excluding anyone already named/linked above.
  const laneSet = new Set((insight.lanes || []).map(norm).filter(Boolean));
  const laneContacts = laneSet.size
    ? contacts.filter((p) => !conIds.has(p.id) && (p.lanes || []).some((l) => laneSet.has(norm(l))))
      .map((p) => ({ id: p.id, name: p.name, company: p.company || "", role: p.role || "", lanes: (p.lanes || []).filter((l) => laneSet.has(norm(l))) }))
    : [];

  // Open leads tied to a connected company/contact or sourced from this insight.
  const relatedLeads = leads.filter((ld) => {
    if (!ACTIVE_LEAD(ld)) return false;
    if (ld.linkedCompanyId && compIds.has(ld.linkedCompanyId)) return true;
    if (ld.linkedContactId && conIds.has(ld.linkedContactId)) return true;
    return (ld.evidence || []).some((e) => e && e.insightId === insight.id);
  }).map((ld) => ({ id: ld.id, name: ld.name, signal: ld.signal || "", pillar: ld.pillar || "", why: ld.why || "" }));

  return { companies: cos, contacts: cons, laneContacts, leads: relatedLeads, line: connectionLine({ companies: cos, contacts: cons, laneContacts, leads: relatedLeads }) };
}

// One human-readable line for the idea rationale (names only, internal guidance).
export function connectionLine({ companies = [], contacts = [], laneContacts = [], leads = [] } = {}) {
  const parts = [];
  if (companies.length) parts.push("Companies: " + companies.map((c) => c.name).join(", "));
  if (contacts.length) parts.push("Named contacts: " + contacts.map((c) => c.name + (c.company ? ` (${c.company})` : "")).join(", "));
  if (leads.length) parts.push("Open leads: " + leads.map((l) => `${l.name}${l.signal ? ` [${l.signal}]` : ""}`).join(", "));
  if (laneContacts.length) parts.push("Relevant by lane: " + laneContacts.slice(0, 4).map((c) => c.name).join(", "));
  return parts.join(" · ");
}

// True when there is anything worth surfacing.
export function hasConnections(c) {
  return !!(c && ((c.companies || []).length || (c.contacts || []).length || (c.leads || []).length || (c.laneContacts || []).length));
}

// ----- self-test (node lib/connect.mjs --self-test) -----
async function selfTest() {
  let failures = 0;
  const test = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
  console.log("lib/connect.mjs --self-test");

  const companies = [
    { id: "com-1", name: "Harbourline Logistics", industry: "logistics" },
    { id: "com-2", name: "Kestrel Exhibitions", industry: "events" },
  ];
  const contacts = [
    { id: "con-1", name: "Mabel Tan", company: "Harbourline Logistics", companyId: "com-1", role: "Founder & CEO", lanes: ["Commercial systems", "Founder-led operating drag"] },
    { id: "con-2", name: "Rory Whitfield", company: "Kestrel Exhibitions", companyId: "com-2", role: "MD", lanes: ["Events"], doNotContact: true },
    { id: "con-3", name: "Priya Raghavan", company: "Parallax Data Rooms", companyId: "com-9", role: "COO", lanes: ["Commercial systems"] },
  ];
  const leads = [
    { id: "lead-1", name: "Harbourline expansion", signal: "funding", status: "detected", linkedCompanyId: "com-1", evidence: [] },
    { id: "lead-2", name: "old lead", signal: "hire", status: "converted", linkedCompanyId: "com-1", evidence: [] },
    { id: "lead-3", name: "from-this-insight", signal: "demand", status: "detected", linkedCompanyId: null, evidence: [{ insightId: "ins-x" }] },
  ];

  test("nameInText is whole-word only and ignores short names", () => {
    if (!nameInText("we met Mabel Tan last week", "Mabel Tan")) throw new Error("should match full name");
    if (nameInText("the arena was full", "AI")) throw new Error("short name must not match");
    if (nameInText("kestrelish nonsense", "Kestrel Exhibitions")) throw new Error("must not substring-match inside a word");
  });

  test("connectInsight links a company named in the text, plus its contact", () => {
    const ins = { id: "ins-x", title: "Harbourline Logistics keeps blaming the tool", raw: "The founder migrated CRM three times.", lanes: ["Commercial systems"] };
    const c = connectInsight(ins, { companies, contacts, leads });
    if (!c.companies.some((x) => x.name === "Harbourline Logistics")) throw new Error("company not linked");
    if (!c.contacts.some((x) => x.name === "Mabel Tan")) throw new Error("contact at the company not surfaced");
    if (c.contacts.some((x) => x.name === "Priya Raghavan")) throw new Error("unrelated contact must not appear as named");
  });

  test("lane-overlap contacts are surfaced separately and de-duped from named", () => {
    const ins = { id: "ins-y", title: "A definitions problem, not a tool problem", raw: "No company named here.", lanes: ["Commercial systems"] };
    const c = connectInsight(ins, { companies, contacts, leads });
    if (c.companies.length) throw new Error("no company named -> none linked");
    const laneNames = c.laneContacts.map((x) => x.name);
    if (!laneNames.includes("Mabel Tan") || !laneNames.includes("Priya Raghavan")) throw new Error("lane contacts missing");
  });

  test("open leads tied to a connected company or sourced from the insight, active only", () => {
    const ins = { id: "ins-x", title: "Harbourline Logistics", raw: "", lanes: [] };
    const c = connectInsight(ins, { companies, contacts, leads });
    const ids = c.leads.map((l) => l.id);
    if (!ids.includes("lead-1")) throw new Error("lead via linked company missing");
    if (!ids.includes("lead-3")) throw new Error("lead via insight evidence missing");
    if (ids.includes("lead-2")) throw new Error("converted lead must be excluded");
  });

  test("connectionLine and hasConnections behave", () => {
    const c = connectInsight({ id: "ins-x", title: "Harbourline Logistics", raw: "", lanes: ["Commercial systems"] }, { companies, contacts, leads });
    if (!hasConnections(c)) throw new Error("should have connections");
    if (!c.line.includes("Harbourline") || !c.line.includes("Mabel Tan")) throw new Error("line should name company + contact");
    if (hasConnections(connectInsight(null, {}))) throw new Error("null insight -> no connections");
  });

  if (failures) { console.log(`${failures} failing`); process.exit(1); }
  console.log("all passing");
}

if (process.argv[1] && (await import("node:url")).fileURLToPath(import.meta.url) === (await import("node:path")).resolve(process.argv[1])) {
  if (process.argv.includes("--self-test")) selfTest();
}
