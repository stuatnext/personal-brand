# Data dictionary

Every collection is one file in `data/`, shaped
`{ meta: {...}, items: [...] }` (except `settings.json`:
`{ meta, values }`, and `voice.json`: `{ meta, rules, examples,
pendingExtractions }`). Every item carries `id`, `createdAt`, `updatedAt`,
optional `deletedAt` (soft delete) and, on demo records, `fictional: true`.
Ids are prefixed by type (`ins-`, `con-`, `cnt-`, `out-`, `opp-`, …) so a
reference is self-describing.

Relationships are by id reference; one insight can feed many content items,
contacts and opportunities (`sourceInsights[]`, `relatedContacts[]`,
`relatedContent[]`, `relatedOutreach[]`).

## Collections

### settings
`values`: `accentColor`, `demoMode`, `contentThresholds {strong,
publishAfterEdits}`, `outreachWeights` (7 factors summing 100),
`authorityWeights` (8 components summing 100), `outreachCooldownDays`.

### brands
The four workspaces (Stuart Crowley, Strait Up Growth, NEXT.io,
NEXTPredict): `audience`, `voiceNote`, `ctas[]`, `restrictedTopics[]`,
`dataAccess`. NEXT.io is confidential-by-default.

### lanes
The 15 authority lanes. Referenced by **name** everywhere (readability
over normalisation at this scale).

### offers
`name`, `draft` (true = assumption), `problem`, `outcome`,
`primaryArtifacts`, `lanes[]`, `targetBuyer`, `buyerTrigger`,
`pricingLogic`, `proofRequired`, `conversionNotes[]`.

### insights
`title`, `raw` (lossless, never truncated), `source`, `date`, `type`,
`lanes[]`, `audiences[]`, `commercialRelevance` (1–5), `confidence`,
`confidentiality {classification, reasons[], score, confirmed}`,
`distilled {coreInsight, strongestClaim, evidence[], publicSafeVersion,
contentAngles[], outreachAngle, speakingAngle, commercialAngle, provider}`,
`relatedContacts[]`, `relatedCompanies[]`, `relatedOffers[]`, `status`
(`captured → distilled → routed`).

### contacts
`name`, `role`, `company`, `companyId`, `location`, `industry`,
`relationshipType`, `lanes[]`, `howKnown`, `email` (null unless genuinely
known — never guessed), `linkedin`, `sharedInterests`, `potentialValue`,
`permissionStatus`, `doNotContact`, `notes[]`, `nextAction`,
`followUpDate`. Relationship strength is **computed** from interactions,
never stored.

### companies
`name`, `location`, `industry`, `note`.

### interactions
The relationship event log: `contactId`, `kind` (meeting, call, reply,
comment, message, event, intro, referral), `direction`, `note`, `date`.
Feeds relationship strength and timelines.

### content
`title`, `format`, `stage` (`raw-idea → qualified-idea → outline → draft →
review → approved → scheduled → published → repurposed → archived`),
`lanes[]`, `audiences[]`, `objective`, `brand`, `sourceInsights[]`
(provenance), `evidence[]`, `pov`, `cta`, `confidentiality`, `body`,
`versions[]` (prior bodies kept), `draftProvider`, `score` (see scoring),
`scoreOverrides` (Stuart's per-criterion values, always win),
`plannedDate`, `publishedDate`, `channel`, `url`,
`performance {impressions, comments, conversationsCreated[],
contactsInfluenced[], opportunitiesInfluenced[]}`, `approval`.

### engagements
The triage inbox: `contactId` | `personName`, `contentId`, `kind`, `text`,
`recommendation` + reason, `status` (`open`/`handled`), `date`.

### outreach
`contactId`, `purpose`, `trigger` (why now), `valueToRecipient`,
`evidence[]` (what the personalisation is based on — provenance),
`channel`, `message`, `draftProvider`, `stage` (`identified → researched →
qualified → drafted → approved → sent → replied → conversation → meeting →
opportunity → closed`, plus `paused`, `do-not-contact`), `approval
{status, approvedBy, approvedAt}`, `sentAt`, `reply {text, sentiment,
date}`, `followUpDate`, `outcome`, `learning`, `lanes[]`, `score` (7-factor
breakdown).

### opportunities
`name`, `type` (client, advisory, speaking, podcast, media, partnership,
referral, workshop, board), `contactIds[]`, `companyId`, `offerId`,
`source`, `contentInfluence` (`direct-source | strong-influence |
supporting-influence | no-proven-influence`), `stage` (`signal →
conversation → qualified → diagnostic → proposal → decision → won | lost |
nurture`), `estimatedValue` + `currency` + `probability` (Stuart-entered
only), `nextAction`, `nextActionDate`, `lastActivityAt`, `evidence`,
`risks`, `relatedContent[]`, `relatedOutreach[]`, `outcome`, `revenue`,
`lostReason`, `lessons`.

### tasks
`title`, `due`, `kind` (follow-up, preparation, build, hygiene),
`relatedType` + `relatedId`, `status` (open/done/skipped), `deferredCount`
(3+ deferrals get surfaced on Today).

### knowledge
`kind` (voice, pov, objection, brand-boundary, proof-point, market-intel,
template, link, meeting-note), `title`, `body`, `tags[]`.

### calendar
`date`, `title`, `format`, `lane`, `objective`, `status`, `contentId`.

### reviews
`kind` (weekly/monthly), `period`, `body` (structured object),
`status` (`draft` until Stuart confirms).

### audit
Append-only: `at`, `actor`, `action`, `collection`, `id`, `summary`.
Bounded to the last 5,000 entries.

### voice (document)
`rules[]` (`status: approved` = active in AI context; `proposed` = inert),
`examples[]` (`verdict: approved | rejected | reference-only`),
`pendingExtractions[]` (from the teach-by-edit loop).

### prompts
Editable AI system prompts: `insight-distillation`, `content-drafting`,
`content-review`, `relationship-review`, `outreach-drafting`,
`outreach-review`, `weekly-authority-review`.
