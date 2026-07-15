#!/usr/bin/env node
// seed.mjs — writes the canonical configuration (brands, lanes, offers,
// voice, prompts, settings) and a FICTIONAL demonstration dataset that
// exercises every workflow end to end. Every demo item carries
// `fictional: true` and fictional company/people names. Offers and
// positioning are DRAFT ASSUMPTIONS until Stuart confirms them.
//
//   node scripts/seed.mjs            # refuses to overwrite real data
//   node scripts/seed.mjs --force    # overwrite regardless
//   node scripts/seed.mjs --config-only  # only settings/brands/lanes/offers/voice/prompts

import fs from 'node:fs';
import path from 'node:path';
import { DATA, COLLECTIONS, read, write } from '../lib/store.mjs';
import { scoreContent, scoreOutreach, relationshipStrength } from '../lib/scoring.mjs';
import { lint } from '../lib/voice.mjs';
import { review as confReview } from '../lib/confidentiality.mjs';

const FORCE = process.argv.includes('--force');
const CONFIG_ONLY = process.argv.includes('--config-only');

const now = new Date();
const iso = (offsetDays = 0, hour = 9) => {
  const d = new Date(now.getTime() + offsetDays * 86400000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const day = (offsetDays = 0) => iso(offsetDays).slice(0, 10);

// Safety: never clobber real (non-fictional) records without --force.
if (!FORCE) {
  for (const c of ['insights', 'contacts', 'content', 'outreach', 'opportunities']) {
    const existing = read(c).items || [];
    if (existing.some((i) => !i.fictional)) {
      console.error(`data/${c}.json contains non-fictional records. Refusing to overwrite. Use --force if you really mean it.`);
      process.exit(1);
    }
  }
}

const meta = (note) => ({ seededAt: now.toISOString(), note });
const FICTION = 'FICTIONAL demonstration data. Not a real person, company or deal.';

// ---------------------------------------------------------------------------
// Settings — every weight and threshold the scoring engines use.
// ---------------------------------------------------------------------------
write('settings', {
  meta: meta('Editable engine settings. Change here, not in code.'),
  values: {
    accentColor: '#B34700',
    demoMode: true,
    owner: 'Stuart Crowley',
    contentThresholds: { strong: 48, publishAfterEdits: 36 },
    outreachWeights: {
      relationshipStrength: 15, triggerRelevance: 20, valueToRecipient: 20,
      strategicFit: 15, evidenceOfInterest: 10, timing: 10, messageSpecificity: 10,
    },
    authorityWeights: {
      operatorCredibility: 20, publishedThinking: 15, distinctPointOfView: 15,
      relationshipQuality: 15, speakingMedia: 10, commercialOutcomes: 15,
      consistency: 5, marketRelevance: 5,
    },
    outreachCooldownDays: 10,
  },
});

// ---------------------------------------------------------------------------
// Brand workspaces + conflict boundaries.
// ---------------------------------------------------------------------------
write('brands', {
  meta: meta('The four workspaces. Data-access rules feed the brand gate in lib/confidentiality.mjs.'),
  items: [
    {
      id: 'brand-stuart', name: 'Stuart Crowley', kind: 'personal',
      audience: 'Founders, commercial leaders, event and media operators, industry peers',
      voiceNote: 'Commercially sharp, conversational, direct, curious, dry, comfortable admitting uncertainty. British English. Credibility before conversion.',
      ctas: ['Reply with your view', 'DM me', 'No CTA at all is fine'],
      restrictedTopics: ['NEXT.io confidential commercial detail', 'client-identifiable material'],
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    },
    {
      id: 'brand-sug', name: 'Strait Up Growth', kind: 'consultancy',
      audience: 'Founder-led B2B businesses (5-100 people) in Singapore, Asia and Europe: founders, MDs, commercial directors, COOs, heads of growth/sales, marketing directors, RevOps leaders',
      voiceNote: 'Sells commercial clarity and operating leverage, never hours. Narrative: "I know where commercial systems break, and I use AI to make the fix faster." Never an AI agency, never a LinkedIn coaching service.',
      ctas: ['Book a diagnostic conversation', 'Reply and tell me how you run it today'],
      restrictedTopics: ['Anything sourced from NEXT.io confidential material', 'NEXTPredict partner relationships'],
      positioningStatus: 'DRAFT ASSUMPTION. Positioning and services are editable and unconfirmed until Stuart signs them off.',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    },
    {
      id: 'brand-nextio', name: 'NEXT.io', kind: 'employer',
      audience: 'Global B2B iGaming industry',
      voiceNote: 'Employer context. Confidential by default: deals, margins, pipeline, people never leave this workspace (rule R8).',
      ctas: [], restrictedTopics: ['everything not already public'],
      dataAccess: 'confidential-by-default',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    },
    {
      id: 'brand-nextpredict', name: 'NEXTPredict', kind: 'event',
      audience: 'Prediction markets category: operators, infrastructure, capital, compliance',
      voiceNote: 'Category vocabulary only: prediction markets, event contracts, market structure. Never betting/gambling/casino/sportsbook/wagering (linter-enforced). Voice bible: data/voice/stuart-voice.md.',
      ctas: ['Soft summit link, once, as context'],
      restrictedTopics: ['speaker-recruitment framing', 'hard sell on first touch'],
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    },
  ],
});

// ---------------------------------------------------------------------------
// Authority lanes.
// ---------------------------------------------------------------------------
const LANES = [
  'Commercial systems', 'CRM and RevOps governance', 'Pricing and margin discipline',
  'Practical AI implementation', 'B2B events and sponsorship', 'Sales and marketing alignment',
  'Leadership through operating clarity', 'Founder-led operating drag', 'iGaming commercial strategy',
  'Prediction markets', 'Singapore SME AI adoption', 'B2B media monetisation',
  'Commercial negotiation', 'Category creation', 'GTM execution',
];
write('lanes', {
  meta: meta('The authority taxonomy. Everything links to one or more lanes.'),
  items: LANES.map((name, i) => ({
    id: `lane-${String(i + 1).padStart(2, '0')}`, name,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  })),
});
const lane = (name) => name; // lanes are referenced by name for readability

// ---------------------------------------------------------------------------
// Offer library — DRAFT ASSUMPTIONS.
// ---------------------------------------------------------------------------
const offers = [
  ['off-audit', 'Commercial Systems Audit', 'Identify operating drag, workflow gaps, CRM friction, GTM friction and the highest-value improvements.', 'A prioritised 30 to 90 day commercial improvement plan.', ['Commercial systems', 'Founder-led operating drag'], 'Founder or MD who suspects the commercial engine leaks but cannot see where.'],
  ['off-ai-sprint', 'AI Workflow Implementation Sprint', 'Embed AI into one or more important commercial workflows.', 'Workflow map, prompt system, source knowledge structure, governance rules, implementation plan.', ['Practical AI implementation', 'Singapore SME AI adoption'], 'A team whose AI adoption has become disconnected experimentation.'],
  ['off-crm-gtm', 'CRM and GTM Operating System', 'Cleaner source-of-truth logic, stronger pipeline discipline, clearer ownership, better handoffs.', 'CRM governance model, lifecycle design, dashboard specification, operating cadence, action plan.', ['CRM and RevOps governance', 'GTM execution'], 'Commercial leader who no longer trusts the CRM numbers.'],
  ['off-pricing', 'Pricing and Packaging Sprint', 'Improve the value story, package architecture, willingness-to-pay logic, negotiation structure and expansion path.', 'Pricing ladder, package structure, value fences, negotiation playbook, sales narrative.', ['Pricing and margin discipline', 'Commercial negotiation'], 'Founder discounting informally and leaking margin.'],
  ['off-events', 'B2B Event Revenue Architecture', 'Move sponsorship and event monetisation from inventory selling toward outcome-led commercial packages.', 'Sponsor outcome map, package architecture, pricing logic, renewal structure, value measurement plan.', ['B2B events and sponsorship', 'B2B media monetisation'], 'Event business selling logo placement instead of outcomes.'],
  ['off-fractional', 'Fractional Commercial Leadership', 'Reduce founder dependency, clarify commercial priorities, improve GTM execution, strengthen accountability.', 'Commercial priorities, operating cadence, leadership reporting, decision framework, execution plan.', ['Leadership through operating clarity', 'Founder-led operating drag'], 'Founder who is still the bottleneck for every commercial decision.'],
];
write('offers', {
  meta: meta('DRAFT ASSUMPTIONS. Every offer, price and claim here is unconfirmed until Stuart edits and approves it. No client names, testimonials or results may be attached until real ones exist.'),
  items: offers.map(([id, name, problem, artifacts, lanes, buyerTrigger]) => ({
    id, name, status: 'draft-assumption', draft: true,
    problem, outcome: problem, primaryArtifacts: artifacts, lanes, buyerTrigger,
    targetBuyer: 'Founder-led B2B, 5-100 employees, SG/Asia/Europe (draft)',
    pricingLogic: 'UNSET. Value-based, never hours. Stuart to define.',
    proofRequired: 'Real case evidence needed before public claims. None attached yet.',
    conversionNotes: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
  })),
});

// ---------------------------------------------------------------------------
// Voice system — rules imported from the voice bible; examples library.
// ---------------------------------------------------------------------------
write('voice', {
  meta: meta('The voice system. Approved rules feed the AI context; proposed rules wait for Stuart. The linter (lib/voice.mjs) enforces the mechanical bits. Full worldview: data/voice/stuart-voice.md.'),
  rules: [
    { id: 'vr-01', status: 'approved', source: 'voice bible 2026-07-03', text: 'British English, natural contractions, natural paragraphs. Never em dashes.' },
    { id: 'vr-02', status: 'approved', source: 'voice bible 2026-07-03', text: 'No hype-merchant phrases: game changer, exciting times ahead, fascinating development, great insights, we are witnessing, the next evolution of.' },
    { id: 'vr-03', status: 'approved', source: 'voice bible 2026-07-03', text: 'No negative-parallelism cadence: "not just X but Y", "it is not about X it is about Y".' },
    { id: 'vr-04', status: 'approved', source: 'voice bible 2026-07-03', text: '"The part/thing I keep coming back to" is BANNED (Stuart flagged it), despite appearing in older prompt material. The repo linter wins.' },
    { id: 'vr-05', status: 'approved', source: 'voice bible 2026-07-03', text: 'Structure: notice something specific, give the commercial read, connect to the bigger operating question, invite discussion. One ask maximum.' },
    { id: 'vr-06', status: 'approved', source: 'voice bible 2026-07-03', text: 'Comfortable admitting uncertainty ("I am still forming my own view"). Participant and operator, never guru or omniscient analyst.' },
    { id: 'vr-07', status: 'approved', source: 'CLAUDE.md nextpredict', text: 'NEXTPredict copy: category vocabulary only. Never betting, gambling, casino, sportsbook, wagering. (iGaming is fine in Stuart/SUG contexts; it is his sector.)' },
    { id: 'vr-08', status: 'approved', source: 'engine rule', text: 'Credibility before conversion. Not every piece carries a commercial ask; most should not.' },
    { id: 'vr-09', status: 'approved', source: 'engine rule', text: 'Never fabricate statistics, quotes, relationships, experience or client results. Unverified claims are visibly marked unverified.' },
    { id: 'vr-10', status: 'proposed', source: 'ChatGPT product prompt', text: 'Useful openers to keep in rotation: "The useful question is...", "The uncomfortable bit is...", "This feels less like hype now and more like build mode." (Stuart to approve.)' },
  ],
  examples: [
    { id: 'vx-01', type: 'comment', verdict: 'reference-only', source: 'voice handoff (paraphrased shape)', text: 'Warm agreement, one observation from operating experience (latency, settlement, provider quality are familiar headaches), move from front-end to backend, end on a category read. No sell.', note: 'Mirror the shape, never the words.' },
    { id: 'vx-02', type: 'post-pattern', verdict: 'reference-only', source: 'voice bible', text: '1. Odd or unexpected observation. 2. Specific example. 3. The commercial read. 4. The bigger question. 5. Soft brand connection only if it fits. 6. One question if engagement is the goal.', note: 'The canonical post recipe.' },
  ],
  pendingExtractions: [],
});

// ---------------------------------------------------------------------------
// Editable AI system prompts.
// ---------------------------------------------------------------------------
write('prompts', {
  meta: meta('Editable system prompts used by lib/ai.mjs. Edit the text, not the ids.'),
  items: [
    { id: 'insight-distillation', name: 'A. Insight distillation', system: 'You distil a raw commercial note from Stuart Crowley into: core insight, strongest claim, evidence, a public-safe version, content angles, an outreach angle, a speaking angle and a Strait Up Growth commercial angle. Never invent facts, numbers or names. If evidence is missing, say so. Flag anything that identifies NEXT.io deals, colleagues, clients or figures as a confidentiality risk.' },
    { id: 'content-drafting', name: 'Content drafting', system: 'You draft content in Stuart Crowley\'s voice: commercially sharp, conversational, direct, curious, dry, comfortable admitting uncertainty. British English. His structure: notice something specific, explain why it matters commercially, connect it to a bigger operating question, invite discussion. Do not fabricate anything. Mark unverified claims [unverified].' },
    { id: 'content-review', name: 'B. Content review', system: 'You review a draft against: originality, operator credibility, practical value, evidence, relevance, tone, confidentiality, commercial connection. Be specific about the weakest element and the smallest edit that fixes it. Never inflate scores.' },
    { id: 'relationship-review', name: 'C. Relationship review', system: 'You identify who matters now and why, with evidence from logged interactions only. State the value Stuart should provide first, the appropriate action, and reasons NOT to contact. Never invent contact history.' },
    { id: 'outreach-drafting', name: 'Outreach drafting', system: 'You draft short, honest outreach in Stuart\'s voice. A real reason for contact, a clear value exchange, evidence of relevance, a low-pressure next step, and a reason to send it now. No fake familiarity, no flattery, no pressure, no long biography, no em dashes. If the evidence is thin, the message gets shorter, never more invented.' },
    { id: 'outreach-review', name: 'D. Outreach review', system: 'You evaluate a proposed message for relevance, value exchange, timing, specificity, trust and pressure. Flag generic personalisation, unsupported familiarity, weak reason for contact, unclear ask, or a recipient contacted too recently.' },
    { id: 'weekly-authority-review', name: 'E. Weekly authority review', system: 'You draft a weekly review from the recorded week only: what Stuart worked on, which lessons are public-safe vs private, relationship moves, outreach opportunities, one speaking/media action, one commercial action, confidentiality warnings, and what to stop doing. Facts from records; assumptions labelled.' },
  ],
});

if (CONFIG_ONLY) {
  console.log('Config collections seeded (settings, brands, lanes, offers, voice, prompts).');
  process.exit(0);
}

// ===========================================================================
// FICTIONAL DEMONSTRATION DATA from here down. Every item: fictional: true.
// ===========================================================================
const F = { fictional: true, fictionNote: FICTION };

// ----- Companies (12) -------------------------------------------------------
const companies = [
  ['com-s01', 'Harbourline Logistics', 'Singapore', 'B2B logistics SaaS', '~60 staff, founder-led, CRM chaos'],
  ['com-s02', 'Kestrel Exhibitions', 'London', 'B2B events', 'Sponsorship revenue flat, sells inventory not outcomes'],
  ['com-s03', 'Parallax Data Rooms', 'Singapore', 'B2B SaaS', 'Series A, sales and marketing misaligned'],
  ['com-s04', 'Bellwether Podcasts', 'Manchester', 'B2B media', 'Hosts a commercial-leaders podcast'],
  ['com-s05', 'Meridian iGaming Supply', 'Malta', 'iGaming platform supplier', 'Commercial team of 9, pricing informal'],
  ['com-s06', 'Straits Venture Partners', 'Singapore', 'Venture capital', 'SEA B2B fund, hosts founder events'],
  ['com-s07', 'Copperfield Media Group', 'Leeds', 'B2B media and events', 'Legacy publisher moving to events'],
  ['com-s08', 'Quayside Analytics', 'Singapore', 'Data consultancy', 'Partners on RevOps tooling'],
  ['com-s09', 'Northlight Conferences', 'Amsterdam', 'B2B events', 'Runs fintech summits, books speakers'],
  ['com-s10', 'Tanjong Growth Collective', 'Singapore', 'SME founder community', '400-member founder network'],
  ['com-s11', 'Fairway Sports Data', 'Dublin', 'Sports data', 'Exploring prediction-market adjacency'],
  ['com-s12', 'Lantern & Vale', 'Remote', 'Fractional exec network', 'Places fractional commercial leaders'],
];
write('companies', {
  meta: meta(FICTION),
  items: companies.map(([id, name, location, industry, note]) => ({
    id, name, location, industry, note, ...F,
    createdAt: iso(-80), updatedAt: iso(-5),
  })),
});

// ----- Contacts (25) --------------------------------------------------------
// [id, name, role, companyId, type, lanes, howKnown, location, extras]
const contacts = [
  ['con-s01', 'Mabel Tan', 'Founder & CEO', 'com-s01', 'potential-client', ['Commercial systems', 'Founder-led operating drag'], 'Met at a Tanjong Growth Collective dinner, June', 'Singapore', { potentialValue: 'Commercial Systems Audit fit', email: 'demo+mabel@example.test' }],
  ['con-s02', 'Rory Whitfield', 'Commercial Director', 'com-s02', 'potential-client', ['B2B events and sponsorship'], 'Introduced by a former CloserStill colleague', 'London', { potentialValue: 'Event Revenue Architecture fit' }],
  ['con-s03', 'Priya Raghavan', 'COO', 'com-s03', 'potential-client', ['CRM and RevOps governance', 'Sales and marketing alignment'], 'Commented on three CRM-governance posts', 'Singapore', {}],
  ['con-s04', 'Dominic Shaw', 'Host', 'com-s04', 'podcast-host', ['Commercial systems', 'B2B media monetisation'], 'Mutual guest suggestion from a peer', 'Manchester', {}],
  ['con-s05', 'Elena Borg', 'Head of Commercial', 'com-s05', 'igaming-executive', ['iGaming commercial strategy', 'Pricing and margin discipline'], 'Industry peer, met at an iGaming expo 2024', 'Malta', {}],
  ['con-s06', 'Wei Lun Chua', 'Partner', 'com-s06', 'investor', ['GTM execution', 'Singapore SME AI adoption'], 'Panel Q&A conversation, Singapore', 'Singapore', {}],
  ['con-s07', 'Harriet Vane', 'Managing Director', 'com-s07', 'industry-peer', ['B2B media monetisation', 'B2B events and sponsorship'], 'Former colleague from the media world', 'Leeds', {}],
  ['con-s08', 'Josh Ramirez', 'Founder', 'com-s08', 'referral-partner', ['CRM and RevOps governance', 'Practical AI implementation'], 'Collaborated on a client scoping call (fictional)', 'Singapore', {}],
  ['con-s09', 'Annelies de Vries', 'Programme Director', 'com-s09', 'event-organiser', ['B2B events and sponsorship', 'Category creation'], 'Cold inbound after a sponsorship post', 'Amsterdam', {}],
  ['con-s10', 'Faridah Osman', 'Community Lead', 'com-s10', 'singapore-contact', ['Singapore SME AI adoption', 'Founder-led operating drag'], 'Runs the founder community Stuart spoke at', 'Singapore', {}],
  ['con-s11', 'Callum Reid', 'Head of Partnerships', 'com-s11', 'prediction-markets-contact', ['Prediction markets', 'Category creation'], 'Replied to a prediction-markets thread', 'Dublin', {}],
  ['con-s12', 'Grace Liew', 'Principal', 'com-s12', 'referral-partner', ['Leadership through operating clarity'], 'Fractional network intro call', 'Remote', {}],
  ['con-s13', 'Tom Okafor', 'Founder', 'com-s03', 'founder', ['GTM execution', 'Pricing and margin discipline'], 'Engaged repeatedly with pricing posts', 'Singapore', {}],
  ['con-s14', 'Sasha Lindqvist', 'Journalist', 'com-s07', 'journalist', ['B2B media monetisation', 'Category creation'], 'Interviewed Stuart for a trade piece (fictional)', 'Stockholm', {}],
  ['con-s15', 'Ben Carragher', 'Head of Sales', 'com-s01', 'commercial-leader', ['Sales and marketing alignment', 'CRM and RevOps governance'], 'Sat in on the Harbourline intro call', 'Singapore', {}],
  ['con-s16', 'Yuki Nakamura', 'Marketing Director', 'com-s05', 'commercial-leader', ['iGaming commercial strategy'], 'Conference roundtable', 'Tokyo', {}],
  ['con-s17', 'Oliver Grant', 'Speaker Booker', 'com-s09', 'speaker-booker', ['B2B events and sponsorship'], 'Books for Northlight summits', 'Amsterdam', {}],
  ['con-s18', 'Devi Menon', 'Head of Growth', 'com-s10', 'potential-client', ['GTM execution', 'Practical AI implementation'], 'Asked a sharp question at the community talk', 'Singapore', {}],
  ['con-s19', 'Marcus Ellery', 'Former colleague', null, 'former-colleague', ['B2B events and sponsorship'], 'Worked together at a previous employer', 'London', {}],
  ['con-s20', 'Lin Xiu', 'RevOps Lead', 'com-s03', 'commercial-leader', ['CRM and RevOps governance'], 'DMed after a dashboard-honesty post', 'Singapore', {}],
  ['con-s21', 'Pieter Hendriks', 'CEO', 'com-s09', 'potential-client', ['B2B events and sponsorship', 'Pricing and margin discipline'], 'Met at a fintech summit speaker dinner', 'Amsterdam', {}],
  ['con-s22', 'Aisyah Rahman', 'Podcast Producer', 'com-s04', 'media-contact', ['B2B media monetisation'], 'Coordinates guests for Bellwether', 'Manchester', {}],
  ['con-s23', 'Niall Docherty', 'Advisor', null, 'advisor', ['Commercial negotiation', 'Leadership through operating clarity'], 'Long-standing peer mentor (fictional)', 'Edinburgh', {}],
  ['con-s24', 'Chen Wei', 'Founder', 'com-s08', 'technology-partner', ['Practical AI implementation', 'Singapore SME AI adoption'], 'Partner ecosystem, two joint calls', 'Singapore', {}],
  ['con-s25', 'Freya Halvorsen', 'Head of Marketing', 'com-s02', 'commercial-leader', ['Sales and marketing alignment'], 'Opted out of outreach at an event, keep for context only', 'Oslo', { doNotContact: true, permissionStatus: 'opted-out' }],
];
write('contacts', {
  meta: meta(FICTION + ' Emails are only present where the fictional person shared one; the engine never guesses addresses.'),
  items: contacts.map(([id, name, role, companyId, relationshipType, lanes, howKnown, location, extras]) => ({
    id, name, role, companyId,
    company: companies.find((c) => c[0] === companyId)?.[1] || null,
    relationshipType, lanes, howKnown, location,
    permissionStatus: extras.permissionStatus || 'legitimate-contact',
    doNotContact: extras.doNotContact || false,
    email: extras.email || null, linkedin: null,
    sharedInterests: extras.sharedInterests || null,
    potentialValue: extras.potentialValue || null,
    notes: [], nextAction: null, followUpDate: null,
    ...F, createdAt: iso(-75), updatedAt: iso(-2),
  })),
});

// ----- Interactions (relationship events) -----------------------------------
const interactions = [
  ['int-s01', 'con-s01', -18, 'meeting', 'Intro call. Mabel described three CRMs in five years, none trusted. Wants clarity before Q4 planning.'],
  ['int-s02', 'con-s01', -6, 'reply', 'Replied warmly to the follow-up note, asked for a scoping outline.'],
  ['int-s03', 'con-s02', -40, 'meeting', 'Coffee at the Kestrel office. Sponsorship renewals flat three years running.'],
  ['int-s04', 'con-s03', -12, 'comment', 'Commented on the CRM-truth post: "this is exactly our pipeline review".'],
  ['int-s05', 'con-s03', -8, 'comment', 'Second comment, tagged her COO peer group.'],
  ['int-s06', 'con-s03', -3, 'message', 'DM exchange about deal-stage definitions.'],
  ['int-s07', 'con-s04', -25, 'message', 'Podcast host asked about availability in September.'],
  ['int-s08', 'con-s05', -70, 'meeting', 'Long dinner conversation at the expo about supplier pricing discipline.'],
  ['int-s09', 'con-s06', -30, 'event', 'Panel Q&A, swapped views on SEA SaaS GTM.'],
  ['int-s10', 'con-s08', -15, 'call', 'Partnership scoping: they bring data plumbing, Stuart brings commercial design.'],
  ['int-s11', 'con-s10', -21, 'event', 'Spoke at the Tanjong founder session on operating drag.'],
  ['int-s12', 'con-s13', -9, 'comment', 'Engaged with the pricing-ladder post.'],
  ['int-s13', 'con-s13', -5, 'comment', 'Engaged again: asked about discount authorities.'],
  ['int-s14', 'con-s13', -2, 'comment', 'Third meaningful engagement in a fortnight.'],
  ['int-s15', 'con-s19', -160, 'meeting', 'Catch-up drink last winter. Nothing since.'],
  ['int-s16', 'con-s07', -55, 'call', 'Compared media-to-events transition notes.'],
  ['int-s17', 'con-s21', -50, 'meeting', 'Speaker dinner seat neighbours; discussed sponsor churn.'],
  ['int-s18', 'con-s24', -11, 'call', 'Second joint call on an AI workflow pilot shape.'],
  ['int-s19', 'con-s18', -20, 'reply', 'Asked for the operating-drag checklist after the talk.'],
  ['int-s20', 'con-s23', -33, 'call', 'Quarterly mentor call. Pushed Stuart on positioning drift.'],
];
write('interactions', {
  meta: meta(FICTION),
  items: interactions.map(([id, contactId, d, kind, note]) => ({
    id, contactId, kind, note, date: iso(d), direction: 'two-way',
    ...F, createdAt: iso(d), updatedAt: iso(d),
  })),
});

// ----- Insights (20) ---------------------------------------------------------
// [id, dayOffset, title, raw, lanes, type, relevance, status, extras]
const insights = [
  ['ins-s01', -2, 'Three CRMs in five years means the CRM was never the problem', 'Founder told me she has migrated CRM three times in five years and trusts none of them. Every migration was sold internally as the fix. The actual problem was that sales, marketing and delivery never agreed what a qualified deal was. The tool keeps taking the blame for a definitions problem.', ['CRM and RevOps governance', 'Commercial systems'], 'client-pattern', 5, 'captured', {}],
  ['ins-s02', -3, 'Discount authority is a leadership instrument, not a finance rule', 'Watched a deal review where a rep discounted 22% to close by quarter end. Nobody could say who approved it. Where discount tiers exist and are enforced, margin holds and negotiations get shorter, because the seller stops negotiating against themselves.', ['Pricing and margin discipline', 'Commercial negotiation'], 'commercial-lesson', 5, 'routed', {}],
  ['ins-s03', -4, 'Sponsors renew on outcomes they can show their boss', 'Sponsorship renewal conversations keep failing when the package was logo placement. The renewals that close themselves are the ones where the sponsor walked away with a number they could put in their own board deck.', ['B2B events and sponsorship'], 'commercial-lesson', 5, 'routed', {}],
  ['ins-s04', -5, 'AI pilots die where the workflow was never mapped', 'Every stalled AI adoption story I hear in Singapore SME circles has the same shape: tool bought, prompt shared in Slack, nobody changed the workflow. The teams getting value mapped the workflow first and slotted AI into named steps with an owner.', ['Practical AI implementation', 'Singapore SME AI adoption'], 'client-pattern', 5, 'routed', {}],
  ['ins-s05', -6, 'The founder bottleneck shows up in the CRM before it shows up in revenue', 'In founder-led businesses the tell is deals sitting in "waiting on founder" stages. Operating drag is measurable months before the revenue line feels it.', ['Founder-led operating drag', 'Commercial systems'], 'framework', 4, 'captured', {}],
  ['ins-s06', -8, 'Pipeline reviews that read the dashboard aloud are theatre', 'Sat through a review where the leader read the dashboard to the room. No decision was taken. A pipeline review should end with stage moves, kills and next actions or it is a weather report.', ['CRM and RevOps governance', 'Leadership through operating clarity'], 'contrarian-opinion', 4, 'routed', {}],
  ['ins-s07', -9, 'Event P&Ls hide the media asset inside them', 'Most event businesses sit on an audience asset they only monetise two days a year. The media layer (newsletter, podcast, research) is the recurring revenue nobody staffs.', ['B2B events and sponsorship', 'B2B media monetisation'], 'commercial-lesson', 4, 'captured', {}],
  ['ins-s08', -10, 'NEXT.io Q3 pipeline detail', 'Internal pipeline and margin discussion notes from the quarter. Contains named deals, figures and a pricing disagreement. Useful operating lessons but the specifics are employer-confidential.', ['Commercial systems'], 'meeting-note', 3, 'captured', { confidential: true }],
  ['ins-s09', -12, 'Prediction markets are hiring compliance before marketing', 'Noticeable pattern in the category: the serious venues staff market integrity and compliance roles before they staff growth. That ordering tells you who plans to be around in five years.', ['Prediction markets', 'Category creation'], 'event-observation', 4, 'routed', {}],
  ['ins-s10', -14, 'Singapore SMEs buy outcomes, not AI', 'Founder dinner conversation: nobody asked which model anyone uses. Every question was some version of "what stopped being painful". The AI-first pitch is talking to itself.', ['Singapore SME AI adoption', 'Practical AI implementation'], 'event-observation', 5, 'routed', {}],
  ['ins-s11', -16, 'Sales and marketing alignment is a data contract, not a meeting', 'Alignment fails as a standing meeting and works as a shared definition set: one lifecycle, one MQL definition, one routing rule, reviewed quarterly. The meeting is the symptom.', ['Sales and marketing alignment', 'CRM and RevOps governance'], 'framework', 4, 'captured', {}],
  ['ins-s12', -18, 'Category creation is mostly patience plus vocabulary', 'Watching a new category form: the winners repeat a small stable vocabulary until the market adopts it. The losers rebrand their language every quarter.', ['Category creation', 'Prediction markets'], 'contrarian-opinion', 3, 'captured', {}],
  ['ins-s13', -20, 'The diagnostic is the product', 'Advisory conversations keep proving it: the paid diagnostic that names the problem precisely is worth more to the buyer than the fix, because it converts anxiety into a plan.', ['Commercial systems', 'GTM execution'], 'offer-insight', 5, 'routed', {}],
  ['ins-s14', -22, 'Fractional leadership fails without a decision framework', 'Fractional roles collapse when every decision still routes through the founder. The fix is a written decision framework in week one: what the fractional leader decides alone, consults on, or escalates.', ['Leadership through operating clarity', 'Founder-led operating drag'], 'commercial-lesson', 4, 'captured', {}],
  ['ins-s15', -25, 'Media monetisation: the rate card is a positioning document', 'A publisher raising prices found the objection was never budget, it was comparison. Reframed the rate card around outcomes and categories they owned; the same numbers stopped being questioned.', ['B2B media monetisation', 'Pricing and margin discipline'], 'client-pattern', 4, 'captured', {}],
  ['ins-s16', -28, 'iGaming supplier pricing is where discipline goes to die', 'Supplier deals in iGaming still run on relationship pricing and side letters. The first supplier to run clean tiered packaging will look expensive and win anyway, because procurement can finally compare.', ['iGaming commercial strategy', 'Pricing and margin discipline'], 'contrarian-opinion', 4, 'captured', {}],
  ['ins-s17', -30, 'Question: what does a "qualified conversation" actually mean', 'If the whole engine optimises for qualified conversations, the definition needs to be written down: right person, real problem, honest interest in discussing it. Otherwise the metric inflates like impressions did.', ['GTM execution', 'Commercial systems'], 'question', 4, 'captured', {}],
  ['ins-s18', -35, 'Speaking works when the talk is a diagnostic in disguise', 'The talks that generate conversations are the ones where the audience self-diagnoses while listening. Teaching the checklist beats telling the story.', ['B2B events and sponsorship', 'GTM execution'], 'speaking-idea', 4, 'captured', {}],
  ['ins-s19', -38, 'Prediction: SME AI budgets consolidate to two tools by 2027', 'Prediction, low confidence: the ten-tool AI stack SMEs assembled in 2025 consolidates to two by 2027, and the survivors are the ones embedded in a workflow with an owner. [unverified prediction]', ['Singapore SME AI adoption', 'Practical AI implementation'], 'prediction', 3, 'captured', {}],
  ['ins-s20', -42, 'Renewal conversations start at onboarding', 'The renewal rate was decided in the first thirty days: whether the client got a named outcome and a cadence. Everything after is commentary.', ['Commercial systems', 'CRM and RevOps governance'], 'commercial-lesson', 4, 'captured', {}],
];
write('insights', {
  meta: meta(FICTION + ' ins-s08 exists to demonstrate the confidentiality filter catching employer material.'),
  items: insights.map(([id, d, title, raw, lanes, type, relevance, status, extras]) => {
    const conf = confReview(raw);
    return {
      id, title, raw, source: extras.confidential ? 'internal meeting (fictional)' : 'Stuart, direct observation (fictional demo)',
      date: day(d), type, lanes, audiences: ['founders', 'commercial leaders'],
      commercialRelevance: relevance, confidence: 'medium',
      confidentiality: { ...conf, confirmed: false },
      distilled: null, relatedContacts: [], relatedCompanies: [], relatedOffers: [],
      nextAction: status === 'captured' ? 'Distil and route' : null, status,
      ...F, createdAt: iso(d), updatedAt: iso(d),
    };
  }),
});

// ----- Content (16: 10 published, others across stages) -----------------------
const mkPerf = (impressions, comments, conv = [], opps = []) => ({ impressions, comments, conversationsCreated: conv, contactsInfluenced: [], opportunitiesInfluenced: opps });
const contentRows = [
  // id, dayPublished(null if not), stage, format, title, lanes, objective, sourceInsights, pov, body, performance
  ['cnt-s01', -9, 'published', 'linkedin-post', 'Your CRM is not the problem', ['CRM and RevOps governance'], 'establish-expertise', ['ins-s01'],
    'CRM migrations keep failing because the definitions were never agreed.',
    `A founder told me last month she has changed CRM three times in five years and trusts none of them.\n\nEvery migration was sold internally as the fix. It never was. Sales, marketing and delivery had never agreed what a qualified deal actually is, so every system faithfully reported a different version of the truth.\n\nI've rebuilt commercial reporting on top of HubSpot enough times to say this plainly: the tool takes the blame for a definitions problem. Agree the lifecycle first, in writing, with the people who own each stage. Then the cheapest CRM you can find will outperform the last three.\n\nThe useful question is: if your CRM vanished tomorrow, could your team write down what a qualified deal is on one page and all sign it?`,
    mkPerf(4100, 12, ['con-s03', 'con-s20'], ['opp-s01'])],
  ['cnt-s02', -12, 'published', 'linkedin-post', 'Who approved that discount?', ['Pricing and margin discipline'], 'challenge-weak-thinking', ['ins-s02'],
    'Discount authority is a leadership instrument.',
    `Sat in a deal review recently where a 22% discount had closed the quarter's biggest deal. I asked who approved it. Silence.\n\nThat silence is expensive. When nobody owns discount authority, every seller negotiates against themselves and calls it customer focus. I've introduced tiered discount authorities in a commercial team before and the effect was immediate: margins held, and oddly, deals closed faster. Buyers respect a seller who can't just keep sliding.\n\nStill forming a view on where the tiers should sit for smaller founder-led teams. If you run one, how do you handle it today?`,
    mkPerf(6200, 19, ['con-s13'], ['opp-s02'])],
  ['cnt-s03', -15, 'published', 'linkedin-post', 'Sponsors renew on evidence, not logos', ['B2B events and sponsorship'], 'establish-expertise', ['ins-s03'],
    'Outcome-led packages renew themselves.',
    `Sponsorship renewals aren't a sales problem. They're an evidence problem.\n\nWhen the package was logo placement and a booth, the renewal call is a negotiation about price. When the sponsor walked away with a number they could put in their own board deck, the renewal call is a scheduling exercise.\n\nI've sold and renewed event sponsorships for years and the pattern holds everywhere: build the package around what the sponsor gets to claim afterwards, and measure it for them, because they won't.\n\nThe uncomfortable bit is that most event P&Ls can't tell you what any sponsor actually got. That's the fix, and it's cheaper than a new sales deck.`,
    mkPerf(3800, 9, ['con-s09', 'con-s21'], ['opp-s03'])],
  ['cnt-s04', -18, 'published', 'linkedin-post', 'Map the workflow before you buy the tool', ['Practical AI implementation', 'Singapore SME AI adoption'], 'educate-market', ['ins-s04'],
    'AI value comes from workflow design, not tool purchase.',
    `Every stalled AI story I hear from SME founders has the same shape. Tool bought. Prompt shared in Slack. Nothing changed.\n\nThe teams getting real value did something boring first: they mapped the workflow, named the steps, gave each step an owner, and then asked where a model removes drag. AI slotted into a mapped workflow compounds. AI sprinkled onto an unmapped one evaporates.\n\nI'm doing this exercise inside my own commercial work at the moment and it's humbling how much of the drag was never the tooling.\n\nIf you've tried an AI rollout that quietly died, I'd genuinely like to hear what it looked like from the inside.`,
    mkPerf(5400, 22, ['con-s18', 'con-s24'], [])],
  ['cnt-s05', -21, 'published', 'linkedin-post', 'Pipeline reviews should end in decisions', ['CRM and RevOps governance', 'Leadership through operating clarity'], 'challenge-weak-thinking', ['ins-s06'],
    'A review without stage moves is a weather report.',
    `I watched a pipeline review where the leader read the dashboard aloud to the room for forty minutes. Everyone nodded. Nothing moved.\n\nA pipeline review has one job: decisions. Stage moves, kills, next actions with names on them. If the meeting ends and the pipeline looks identical, you held a weather report.\n\nMy rule now: every review ends with three lists. What moved, what died, what has a named action this week. Takes ten minutes longer to run and saves the quarter.\n\nHow does yours end?`,
    mkPerf(2900, 8, [], [])],
  ['cnt-s06', -24, 'published', 'linkedin-post', 'The quiet tell in prediction markets', ['Prediction markets', 'Category creation'], 'build-authority', ['ins-s09'],
    'Compliance-first hiring separates the serious venues.',
    `A pattern worth watching in prediction markets: the serious venues are hiring market integrity and compliance people before they hire growth people.\n\nThat ordering is the tell. It says who is building infrastructure for a decade and who is optimising a moment. I've watched the same split play out in other regulated categories, and the compliance-first firms looked slow right up until they were the only ones left standing.\n\nI'm still learning my way into parts of this category, but hiring order is one of the more honest indicators I've found. Worth checking before you partner with, supply to, or bet your career on a venue.`,
    mkPerf(3100, 11, ['con-s11'], [])],
  ['cnt-s07', -27, 'published', 'linkedin-post', 'Nobody at the founder dinner asked about models', ['Singapore SME AI adoption'], 'start-conversations', ['ins-s10'],
    'SMEs buy relief from pain, not AI.',
    `Founder dinner in Singapore last month. AI came up constantly. Not once did anyone ask which model anyone uses.\n\nEvery question was a version of "what stopped being painful". Invoicing follow-ups. Proposal drafts. CRM hygiene. The vendors pitching AI-first are answering a question nobody at that table was asking.\n\nIf you sell to SMEs, the pitch that lands is the workflow that stopped hurting, with the model as a footnote.`,
    mkPerf(4700, 15, ['con-s10'], [])],
  ['cnt-s08', -31, 'published', 'newsletter', 'The diagnostic is the product', ['Commercial systems', 'GTM execution'], 'support-offer', ['ins-s13'],
    'Naming the problem precisely is worth more than fixing it.',
    `Longer piece on why the paid diagnostic beats the free proposal: it converts anxiety into a plan, prices the thinking, and qualifies the buyer. [Full newsletter body drafted; fictional demo record.]`,
    mkPerf(900, 4, ['con-s01'], ['opp-s01'])],
  ['cnt-s09', -36, 'published', 'linkedin-post', 'Events are sitting on a media business', ['B2B events and sponsorship', 'B2B media monetisation'], 'establish-expertise', ['ins-s07'],
    'The audience asset earns two days a year; the media layer is the recurring revenue.',
    `Most event businesses monetise their audience two days a year and call the other 363 marketing.\n\nI've built the other model: the newsletter, podcast and research layer that turns an event audience into recurring media revenue. It's not glamorous, and it outearns the event within a couple of years if you staff it like a business rather than a promo channel.\n\nIf you run events and your media line is a rounding error, that's not a market problem.`,
    mkPerf(3500, 10, ['con-s07'], ['opp-s04'])],
  ['cnt-s10', -44, 'published', 'linkedin-post', 'Renewals are decided in onboarding', ['Commercial systems'], 'establish-expertise', ['ins-s20'],
    'The first thirty days set the renewal.',
    `Looked back at a year of renewals once and the pattern was embarrassing in its clarity: the renewal was decided in the first thirty days. Named outcome, agreed cadence, first proof delivered. Everything after was commentary.\n\nIf your renewal conversations feel like negotiations, the fix is upstream.`,
    mkPerf(2200, 5, [], [])],
  // In-flight items
  ['cnt-s11', null, 'review', 'linkedin-post', 'The founder bottleneck is visible in the CRM first', ['Founder-led operating drag', 'CRM and RevOps governance'], 'establish-expertise', ['ins-s05'],
    'Operating drag is measurable before revenue feels it.',
    `In founder-led businesses the tell is deals sitting in a "waiting on founder" stage.\n\nOperating drag shows up in the CRM months before it shows up in revenue. Count the deals waiting on one person's calendar and you have a leading indicator most boards never see.\n\n[Needs one concrete anonymised example before approval.]`,
    null],
  ['cnt-s12', null, 'review', 'podcast-outline', 'Guest outline: commercial chaos to usable systems', ['Commercial systems', 'Practical AI implementation'], 'attract-podcast-invitations', ['ins-s01', 'ins-s04'],
    'The founder-friendly version of the systems story.',
    `Outline for the Bellwether appearance: 1. The three-CRMs story. 2. Why definitions beat tools. 3. Where AI genuinely removes drag. 4. The one-page commercial operating picture. [Draft outline; confirm before recording.]`,
    null],
  ['cnt-s13', null, 'draft', 'linkedin-post', 'Alignment is a data contract', ['Sales and marketing alignment'], 'educate-market', ['ins-s11'], 'The meeting is the symptom.', `[Drafting from ins-s11: one lifecycle, one MQL definition, one routing rule, reviewed quarterly.]`, null],
  ['cnt-s14', null, 'qualified-idea', 'article', 'The rate card is a positioning document', ['B2B media monetisation', 'Pricing and margin discipline'], 'establish-expertise', ['ins-s15'], null, '', null],
  ['cnt-s15', null, 'raw-idea', 'linkedin-post', 'What "qualified conversation" should actually mean', ['GTM execution'], 'start-conversations', ['ins-s17'], null, '', null],
  ['cnt-s16', null, 'raw-idea', 'speaking-proposal', 'Talk: the self-diagnosing audience', ['B2B events and sponsorship', 'GTM execution'], 'attract-speaking-invitations', ['ins-s18'], null, '', null],
];
write('content', {
  meta: meta(FICTION + ' Published bodies are demo copy written to pass the voice linter.'),
  items: contentRows.map(([id, d, stage, format, title, lanes, objective, sourceInsights, pov, body, performance]) => {
    const item = {
      id, title, format, lanes, objective, stage, sourceInsights, pov, body,
      audiences: ['founders', 'commercial leaders'], brand: 'brand-stuart',
      evidence: sourceInsights.map((s) => `insight:${s}`),
      cta: null, confidentiality: 'public',
      plannedDate: stage === 'published' ? day(d) : stage === 'review' ? day(2) : null,
      publishedDate: stage === 'published' ? day(d) : null,
      channel: stage === 'published' ? 'linkedin' : null, url: null,
      performance, relatedContacts: [], versions: [],
      ...F, createdAt: iso((d ?? -1) - 2), updatedAt: iso(d ?? -1),
    };
    // cnt-s01 demonstrates manual criterion overrides beating the heuristic:
    // Stuart judged the evidence and commercial relevance higher than the
    // pre-score did, which lifts it over the publish threshold.
    if (id === 'cnt-s01') item.scoreOverrides = { evidence: 5, commercialRelevance: 4 };
    if (body && body.length > 100) {
      item.score = scoreContent(item, { lintResult: lint(body, { brand: 'stuart', kind: 'post' }) });
    }
    return item;
  }),
});

// ----- Engagements (12, con-s13 three times for repeat-engager logic) --------
const engagements = [
  ['eng-s01', -12, 'con-s03', 'Priya Raghavan', 'cnt-s01', 'comment', '"This is exactly our pipeline review. Three systems, three truths."', 'reply-publicly', 'handled'],
  ['eng-s02', -8, 'con-s03', 'Priya Raghavan', 'cnt-s05', 'comment', 'Tagged two COO peers under the pipeline-review post.', 'send-dm', 'handled'],
  ['eng-s03', -9, 'con-s13', 'Tom Okafor', 'cnt-s02', 'comment', 'Asked how discount tiers work below 20 staff.', 'reply-publicly', 'handled'],
  ['eng-s04', -5, 'con-s13', 'Tom Okafor', 'cnt-s02', 'comment', 'Followed up on discount authorities thread.', 'reply-publicly', 'handled'],
  ['eng-s05', -2, 'con-s13', 'Tom Okafor', 'cnt-s10', 'comment', 'Third engagement: renewal-onboarding link to his own churn.', 'send-dm', 'open'],
  ['eng-s06', -6, 'con-s20', 'Lin Xiu', 'cnt-s01', 'dm', 'DM: asked for the one-page lifecycle definition template.', 'reply-dm', 'open'],
  ['eng-s07', -14, 'con-s09', 'Annelies de Vries', 'cnt-s03', 'comment', 'Sponsorship-evidence post resonated; asked about measurement plans.', 'send-dm', 'handled'],
  ['eng-s08', -11, 'con-s11', 'Callum Reid', 'cnt-s06', 'comment', 'Added a data-partnership angle on the compliance-hiring post.', 'reply-publicly', 'handled'],
  ['eng-s09', -17, 'con-s18', 'Devi Menon', 'cnt-s04', 'comment', 'Described their stalled AI rollout in detail.', 'reply-publicly', 'handled'],
  ['eng-s10', -20, null, 'Unknown commenter (fictional)', 'cnt-s07', 'comment', 'Generic praise, no substance.', 'like-only', 'handled'],
  ['eng-s11', -4, 'con-s22', 'Aisyah Rahman', 'cnt-s12', 'email-reply', 'Confirmed September podcast slots available.', 'create-follow-up', 'open'],
  ['eng-s12', -1, 'con-s01', 'Mabel Tan', 'cnt-s08', 'email-reply', 'Replied to the diagnostic newsletter: "this is us, can we talk scoping".', 'create-opportunity', 'handled'],
];
write('engagements', {
  meta: meta(FICTION),
  items: engagements.map(([id, d, contactId, personName, contentId, kind, text, recommendation, status]) => ({
    id, contactId, personName, contentId, kind, text,
    recommendation, recommendationReason: 'Suggested from engagement kind and history; Stuart decides.',
    status, date: iso(d), ...F, createdAt: iso(d), updatedAt: iso(d),
  })),
});

// ----- Outreach (11) ----------------------------------------------------------
const outreachRows = [
  // id, contactId, purpose, stage, trigger, value, evidence, message, extras
  ['out-s01', 'con-s01', 'follow-up-after-meeting', 'conversation', 'Mabel asked for a scoping outline after the intro call', 'A one-page scoping outline for the audit she asked about', ['int-s01: intro call notes', 'eng-s12: replied to the diagnostic newsletter asking to talk scoping'],
    `Hi Mabel,\n\nGood to talk last week. You asked for a scoping outline for the commercial systems piece, so here it is, one page as promised.\n\nThe short version: two weeks of looking at how deals actually move through Harbourline, then a prioritised plan you could hand to the team. If the shape looks right, happy to walk through it on a short call.\n\nStuart`,
    { sentAt: iso(-5), reply: { text: 'This looks right. Can we do Thursday?', sentiment: 'positive', date: iso(-4) }, followUpDate: day(1) }],
  ['out-s02', 'con-s04', 'podcast-pitch', 'meeting', 'Dominic asked about September availability', 'A guest episode on turning commercial chaos into systems, with practical material his audience can use', ['int-s07: host asked about availability', 'eng-s11: producer confirmed September slots'],
    `Hi Dominic,\n\nSeptember works. The angle I'd bring: why commercial systems break in founder-led businesses, told through specifics rather than frameworks. Three stories, each with the fix.\n\nIf that fits the show, Aisyah mentioned the 10th or the 17th.\n\nStuart`,
    { sentAt: iso(-20), reply: { text: 'Booked for the 17th.', sentiment: 'positive', date: iso(-18) } }],
  ['out-s03', 'con-s02', 'new-business-conversation', 'replied', 'Rory mentioned flat sponsorship renewals three years running', 'The sponsor outcome map exercise, which he can run internally even if we never work together', ['int-s03: coffee meeting notes'],
    `Hi Rory,\n\nBeen thinking about the flat-renewals point since our coffee. One exercise that might be useful regardless of anything else: map what each sponsor could claim internally after the event. If the answer is thin, the renewal conversation was lost before it started.\n\nHappy to talk through how I'd run that if useful.\n\nStuart`,
    { sentAt: iso(-15), reply: { text: 'Interesting. Send me the shape of it.', sentiment: 'positive', date: iso(-13) }, followUpDate: day(-2) }],
  ['out-s04', 'con-s09', 'follow-up-after-content-engagement', 'approved', 'Annelies asked about sponsor measurement plans under the renewals post', 'A concrete answer to the measurement question she raised publicly', ['eng-s07: her comment on cnt-s03'],
    `Hi Annelies,\n\nYour question under my sponsorship post deserved a longer answer than a comment. The measurement plan I use has three layers: what the sponsor claims internally, what the audience did, and what renewed. Happy to share the one-pager.\n\nNo agenda beyond that; the question was a good one.\n\nStuart`,
    {}],
  ['out-s05', 'con-s13', 'follow-up-after-content-engagement', 'drafted', 'Third meaningful engagement in a fortnight, latest on renewals and churn', 'A direct exchange on the discount-authority question he keeps raising', ['eng-s03, eng-s04, eng-s05: three comments in two weeks'],
    `Hi Tom,\n\nYou've asked two of the sharpest questions under my pricing posts recently, and the churn point today made me want to take it out of the comments.\n\nHow are you handling discount authority at Parallax today? Asking because the below-20-staff version is genuinely different and I'm still testing my own answer.\n\nStuart`,
    {}],
  ['out-s06', 'con-s19', 'reconnect', 'drafted', 'None recorded', null, [],
    `Hi Marcus,\n\n[No live trigger on record. The engine flagged this draft as weak: no reason to write now, no stated value. Find a real trigger or do not send.]\n\nStuart`,
    {}],
  ['out-s07', 'con-s17', 'speaking-outreach', 'drafted', 'Northlight programmes autumn summits around now (fictional)', 'A talk where the audience self-diagnoses their commercial systems, which fits his practitioner-track brief', ['int-s17: Pieter conversation referenced the autumn programme'],
    `Hi Oliver,\n\nPieter mentioned you're shaping the autumn programme. I have a talk that's been landing well in founder rooms: the commercial systems audit as a live exercise, where the audience diagnoses their own operation while listening.\n\nIf the practitioner track has space, happy to send the abstract.\n\nStuart`,
    {}],
  ['out-s08', 'con-s08', 'partnership-conversation', 'sent', 'Second joint scoping call completed', 'A concrete pilot shape both sides can take to one client each', ['int-s10: partnership scoping call', 'int-s18: second call on pilot shape'],
    `Hi Josh,\n\nFollowing our call: the pilot shape that makes sense to me is one client each, same diagnostic format, then we sit down and see what the data layer needs to feed it.\n\nIf that still works for you, I'll draft the one-pager this week.\n\nStuart`,
    { sentAt: iso(-8), followUpDate: day(0) }],
  ['out-s09', 'con-s06', 'share-something-useful', 'sent', 'His fund published a SEA SaaS GTM note adjacent to my founder-dinner observation', 'A ground-level data point for a thesis his fund is publicly developing', ['int-s09: panel conversation on SEA SaaS GTM'],
    `Hi Wei Lun,\n\nYour fund's GTM note crossed my feed and it matched something I keep hearing at founder dinners here: nobody asks about models, everyone asks what stopped being painful. Thought the ground-level version might be useful to the thesis.\n\nNo ask; the note was good.\n\nStuart`,
    { sentAt: iso(-12) }],
  ['out-s10', 'con-s14', 'media-pitch', 'qualified', 'Her outlet runs a series on B2B media businesses inside event companies', 'An operator source who has actually built the media-inside-events model', ['int: prior interview (fictional); her series brief is public'],
    null, {}],
  ['out-s11', 'con-s25', 'new-business-conversation', 'do-not-contact', 'n/a', null, [],
    null, { note: 'Freya opted out of outreach. Record exists to demonstrate suppression: the engine blocks drafting for her.' }],
];
{
  const contactsDoc = read('contacts').items;
  const interactionsDoc = read('interactions').items;
  write('outreach', {
    meta: meta(FICTION + ' out-s06 is deliberately weak and out-s11 deliberately suppressed, to demonstrate the qualification gates.'),
    items: outreachRows.map(([id, contactId, purpose, stage, trigger, valueToRecipient, evidence, message, extras]) => {
      const contact = contactsDoc.find((c) => c.id === contactId);
      const item = {
        id, contactId, purpose, stage, trigger, valueToRecipient, evidence,
        channel: purpose.includes('podcast') || purpose.includes('media') ? 'email' : 'linkedin-dm',
        message, brand: 'brand-sug',
        lanes: contact?.lanes || [],
        approval: ['approved', 'sent', 'replied', 'conversation', 'meeting'].includes(stage)
          ? { status: 'approved', approvedBy: 'stuart', approvedAt: iso(-10) }
          : { status: 'pending' },
        sentAt: extras.sentAt || null, reply: extras.reply || null,
        followUpDate: extras.followUpDate || null, outcome: null, learning: null,
        note: extras.note || null,
        ...F, createdAt: iso(-22), updatedAt: iso(-2),
      };
      if (message) {
        const strength = contact ? relationshipStrength(contact, interactionsDoc) : null;
        item.score = scoreOutreach(item, { contact, strength, lintResult: lint(message, { brand: 'strait-up-growth', kind: 'outreach' }) });
      }
      return item;
    }),
  });
}

// ----- Opportunities (8) -------------------------------------------------------
const opps = [
  ['opp-s01', 'Harbourline commercial systems audit', 'client', 'con-s01', 'com-s01', 'off-audit', 'content', 'direct-source', 'qualified', 14000, 0.5, -1, 'Send scoping outline recap and propose Thursday diagnostic call', 1, 'Mabel replied to the diagnostic newsletter asking to talk scoping; intro call confirmed the three-CRMs pattern.'],
  ['opp-s02', 'Parallax pricing and packaging sprint', 'client', 'con-s13', 'com-s03', 'off-pricing', 'content', 'strong-influence', 'conversation', 9000, 0.3, -3, 'Take the discount-authority thread to a call', 3, 'Tom engaged three times on pricing posts; DM drafted.'],
  ['opp-s03', 'Kestrel event revenue architecture', 'client', 'con-s02', 'com-s02', 'off-events', 'relationship', 'supporting-influence', 'diagnostic', 18000, 0.55, -13, 'Send the sponsor outcome map shape Rory asked for', -2, 'Positive reply, then went quiet. Follow-up overdue.'],
  ['opp-s04', 'Copperfield media monetisation advisory', 'advisory', 'con-s07', 'com-s07', 'off-events', 'relationship', 'supporting-influence', 'signal', 12000, 0.2, -25, 'Decide whether to develop or park; no movement in three weeks', null, 'Harriet mentioned the media-line problem after cnt-s09; nothing since. Stale on purpose in the demo.'],
  ['opp-s05', 'Bellwether podcast appearance', 'podcast', 'con-s04', 'com-s04', null, 'content', 'direct-source', 'won', 0, 1, -18, 'Prepare outline cnt-s12, record on the 17th', 20, 'Booked. Value is authority evidence, not revenue.'],
  ['opp-s06', 'Northlight autumn keynote slot', 'speaking', 'con-s17', 'com-s09', null, 'relationship', 'no-proven-influence', 'conversation', 0, 0.4, -6, 'Await reply to out-s07, then send abstract', 7, 'Speaker-booker outreach drafted.'],
  ['opp-s07', 'Quayside joint diagnostic pilot', 'partnership', 'con-s08', 'com-s08', 'off-audit', 'referral', 'no-proven-influence', 'proposal', 8000, 0.6, -8, 'Draft the pilot one-pager promised in out-s08', 0, 'Two scoping calls done; one-pager owed.'],
  ['opp-s08', 'Meridian pricing advisory', 'client', 'con-s05', 'com-s05', 'off-pricing', 'existing-relationship', 'no-proven-influence', 'lost', 15000, 0, -35, null, null, 'Elena took it to an incumbent consultancy. Lesson logged: no iGaming case evidence to show yet.'],
];
write('opportunities', {
  meta: meta(FICTION),
  items: opps.map(([id, name, type, contactId, companyId, offerId, source, contentInfluence, stage, estimatedValue, probability, lastAct, nextAction, nextDays, evidence]) => ({
    id, name, type, contactIds: [contactId], companyId, offerId,
    source, contentInfluence, stage,
    estimatedValue, currency: 'SGD', probability,
    nextAction, nextActionDate: nextDays === null ? null : day(nextDays),
    lastActivityAt: iso(lastAct),
    relatedContent: contentRows.filter((c) => (c[10]?.opportunitiesInfluenced || []).includes(id)).map((c) => c[0]),
    relatedOutreach: outreachRows.filter((o) => o[1] === contactId).map((o) => o[0]),
    lanes: [], evidence, risks: null,
    outcome: stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : null,
    revenue: stage === 'won' ? 0 : null,
    lostReason: stage === 'lost' ? 'Chose incumbent; we lacked category case evidence.' : null,
    lessons: stage === 'lost' ? 'Build one anonymised iGaming pricing proof point before re-approaching this segment.' : null,
    notes: [], ...F, createdAt: iso(-40), updatedAt: iso(lastAct),
  })),
});

// ----- Tasks (8 follow-ups) ------------------------------------------------------
const tasks = [
  ['tsk-s01', 'Send Mabel the scoping recap and propose Thursday', 1, 'follow-up', 'opportunities', 'opp-s01', 'open', 0],
  ['tsk-s02', 'Send Rory the sponsor outcome map shape (overdue)', -2, 'follow-up', 'opportunities', 'opp-s03', 'open', 0],
  ['tsk-s03', 'Draft the Quayside pilot one-pager', 0, 'follow-up', 'opportunities', 'opp-s07', 'open', 0],
  ['tsk-s04', 'Reply to Lin Xiu with the lifecycle template', 0, 'follow-up', 'engagements', 'eng-s06', 'open', 0],
  ['tsk-s05', 'Prepare the Bellwether outline for the 17th', 5, 'preparation', 'content', 'cnt-s12', 'open', 0],
  ['tsk-s06', 'Confirm September podcast date with Aisyah', 2, 'follow-up', 'engagements', 'eng-s11', 'open', 0],
  ['tsk-s07', 'Write the anonymised iGaming pricing proof point', 4, 'build', 'offers', 'off-pricing', 'open', 3],
  ['tsk-s08', 'Log LinkedIn metrics for last week\'s posts', -1, 'hygiene', 'content', null, 'done', 0],
];
write('tasks', {
  meta: meta(FICTION),
  items: tasks.map(([id, title, dueDays, kind, relatedType, relatedId, status, deferredCount]) => ({
    id, title, due: day(dueDays), kind, relatedType, relatedId, status, deferredCount,
    ...F, createdAt: iso(-10), updatedAt: iso(-1),
  })),
});

// ----- Knowledge (10) --------------------------------------------------------------
const knowledge = [
  ['kn-s01', 'voice', 'Voice bible pointer', 'The full voice document lives at data/voice/stuart-voice.md. The linter enforces the mechanical rules; the bible carries the judgement.'],
  ['kn-s02', 'pov', 'POV: the CRM is never the problem', 'Current view: CRM migrations fail because lifecycle definitions were never agreed. Confidence: high, from repeated direct observation. Counterargument: sometimes the tool genuinely cannot model the business; rare below 100 staff. Related: ins-s01, cnt-s01.'],
  ['kn-s03', 'pov', 'POV: sell clarity, not hours', 'Strait Up Growth sells commercial clarity and operating leverage. Day rates commoditise judgement. Confidence: medium; pricing model untested. DRAFT ASSUMPTION.'],
  ['kn-s04', 'objection', 'Objection: "we already have consultants"', 'Response angle: consultants produce decks; this produces an operating system the team runs weekly. Needs proof point before use. [unverified]'],
  ['kn-s05', 'brand-boundary', 'NEXT.io confidentiality boundary', 'Deals, margins, pipeline, people and unannounced strategy from NEXT.io never enter public or Strait Up Growth material. Roles and counts, never names or figures. Mirrors next-os rule R8.'],
  ['kn-s06', 'proof-point', 'Proof points available (career, public CV)', 'Built NEXT.io media division to €1.2M baseline (3x in 18 months); ACV €60K to €100K+; €500K+ monthly affiliate revenue engine; APAC P&Ls at Microgaming and W.Media; prediction-markets vertical GTM. Use bucketed versions publicly; exact figures only where already public in the CV.'],
  ['kn-s07', 'market-intel', 'Singapore SME AI adoption pattern', 'Founders buy pain relief, not models (ins-s10). Adoption stalls without workflow mapping (ins-s04). Two live insights support this; keep collecting.'],
  ['kn-s08', 'template', 'Outreach shape that works', 'Real reason for writing now, one line. Value to them, concrete. One low-pressure ask. Under 150 words. No fake familiarity, no biography.'],
  ['kn-s09', 'link', 'Frequently used links', 'CV: stuart-crowley-cv repo. NEXTPredict summit page: see nextpredict-engine gtm.mjs. LinkedIn: linkedin.com/in/stuart-crowley-b2b561104.'],
  ['kn-s10', 'meeting-note', 'Tanjong founder session notes (fictional)', 'Talk on operating drag landed; strongest reaction to the "waiting on founder" CRM stage line. Devi Menon asked for the checklist. Follow-up captured as eng/tsk records.'],
];
write('knowledge', {
  meta: meta('Mixed: kn-s05/kn-s06/kn-s08/kn-s09 are real working knowledge; the rest are demo/draft records flagged accordingly.'),
  items: knowledge.map(([id, kind, title, body]) => ({
    id, kind, title, body, tags: [kind],
    fictional: ['kn-s02', 'kn-s10'].includes(id),
    createdAt: iso(-30), updatedAt: iso(-1),
  })),
});

// ----- Editorial calendar (4 weeks) --------------------------------------------------
const cal = [];
const calFormats = ['linkedin-post', 'linkedin-post', 'newsletter'];
const calLanes = [
  ['Commercial systems', 'CRM and RevOps governance', 'Practical AI implementation'],
  ['Pricing and margin discipline', 'B2B events and sponsorship', 'Founder-led operating drag'],
  ['Singapore SME AI adoption', 'Sales and marketing alignment', 'Commercial systems'],
  ['Prediction markets', 'B2B media monetisation', 'GTM execution'],
];
for (let w = 0; w < 4; w++) {
  for (let s = 0; s < 3; s++) {
    cal.push({
      id: `cal-s${w}${s}`, date: day(w * 7 + s * 2 + 1),
      title: `${calLanes[w][s]}: slot ${s + 1}, week ${w + 1}`,
      format: calFormats[s], lane: calLanes[w][s],
      objective: s === 2 ? 'educate-market' : 'establish-expertise',
      status: 'planned', contentId: null,
      ...F, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  }
}
write('calendar', { meta: meta(FICTION + ' Balance rule: no lane twice in one week; the calendar view flags violations.'), items: cal });

// ----- Reviews (one weekly, one monthly) ----------------------------------------------
write('reviews', {
  meta: meta(FICTION),
  items: [
    {
      id: 'rev-s01', kind: 'weekly', period: `${day(-7)} to ${day(0)}`,
      body: {
        workedOn: ['Harbourline scoping', 'pricing posts', 'AI workflow mapping talk prep'],
        publicSafeLessons: ['Three CRMs story (anonymised)', 'Discount authority pattern'],
        keepPrivate: ['NEXT.io Q3 pipeline detail (ins-s08)'],
        recommendedTheme: 'Commercial systems',
        contentIdeas: ['Founder bottleneck visible in CRM first', 'Alignment is a data contract', 'Qualified conversation definition'],
        relationshipActions: ['DM Tom Okafor (three engagements)', 'Reply to Lin Xiu', 'Reconnect with Marcus Ellery only if a real trigger appears'],
        stopDoing: 'Drafting reconnects with no trigger (see out-s06).',
        confidentialityWarnings: ['ins-s08 is employer-confidential; lessons only after full anonymisation.'],
      },
      status: 'confirmed', ...F, createdAt: iso(-1), updatedAt: iso(-1),
    },
    {
      id: 'rev-s02', kind: 'monthly', period: now.toISOString().slice(0, 7),
      body: {
        authorityProgress: 'Ten pieces published; conversations concentrated in CRM/pricing lanes.',
        strongestThemes: ['CRM and RevOps governance', 'Pricing and margin discipline'],
        weakestThemes: ['Commercial negotiation', 'Category creation'],
        offerDemand: 'Audit and pricing sprints attract interest; fractional untested. DRAFT reading, small sample.',
        positioningDrift: 'None detected; mentor flagged risk of over-indexing on AI language.',
        decisions: [{ decision: 'Keep AI as the accelerant in the narrative, never the headline.', date: day(-3), rationale: 'Matches positioning: commercial clarity first.' }],
      },
      status: 'confirmed', ...F, createdAt: iso(-3), updatedAt: iso(-3),
    },
  ],
});

// ----- Audit + empty shells for anything not yet written -------------------------------
if (!fs.existsSync(path.join(DATA, 'audit.json'))) write('audit', { meta: meta('Append-only audit log.'), items: [] });
for (const c of COLLECTIONS) {
  const f = path.join(DATA, `${c}.json`);
  if (!fs.existsSync(f)) write(c, { meta: meta('empty'), items: [] });
}

console.log('Seeded. Collections:', COLLECTIONS.join(', '));
console.log('All demonstration records are fictional and flagged fictional: true.');
