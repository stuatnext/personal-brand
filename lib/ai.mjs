// ai.mjs — AI provider abstraction. Anthropic when ANTHROPIC_API_KEY is
// set, otherwise a deterministic mock so the whole app runs offline.
// Every output is labelled with its provider and is a draft for Stuart
// to edit, never something that publishes or sends itself.
// System prompts are editable data (data/prompts.json), not code.

import { items, read } from './store.mjs';
import { lint } from './voice.mjs';
import { review as confidentialityReview } from './confidentiality.mjs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export function providerName() {
  return ANTHROPIC_KEY ? `anthropic:${MODEL}` : 'mock';
}

function prompt(id) {
  const doc = read('prompts');
  return (doc.items || []).find((p) => p.id === id)?.system || '';
}

function voiceContext() {
  const v = read('voice');
  const rules = (v.rules || []).filter((r) => r.status === 'approved').map((r) => `- ${r.text}`).join('\n');
  return `Stuart's voice rules (approved):\n${rules}`;
}

async function callAnthropic(system, user, { maxTokens = 1200 } = {}) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content?.map((b) => b.text || '').join('') || '';
}

function firstSentences(text, n = 2) {
  return (text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).slice(0, n).join(' ').trim();
}

// ---------------------------------------------------------------------------
// Insight distillation (prompt A). Mock: structured extraction with honest
// placeholders that read as instructions to Stuart, never invented facts.
// ---------------------------------------------------------------------------
export async function distillInsight(insight) {
  const conf = confidentialityReview(insight.raw || insight.title, { context: insight.source });
  if (ANTHROPIC_KEY) {
    const system = `${prompt('insight-distillation')}\n\n${voiceContext()}`;
    const user = `Insight titled "${insight.title}" (source: ${insight.source || 'unstated'}, sensitivity suggestion: ${conf.classification}):\n\n${insight.raw}\n\nReturn strict JSON with keys: coreInsight, strongestClaim, evidence (array), publicSafeVersion, contentAngles (array of {format, angle}), outreachAngle, speakingAngle, commercialAngle.`;
    try {
      const text = await callAnthropic(system, user);
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return { provider: providerName(), confidentiality: conf, ...json };
    } catch (err) {
      // fall through to mock so the workflow never dead-ends
      console.error('anthropic distill failed, using mock:', err.message);
    }
  }
  const core = firstSentences(insight.raw, 2) || insight.title;
  const lanes = insight.lanes || [];
  return {
    provider: 'mock',
    confidentiality: conf,
    coreInsight: core,
    strongestClaim: firstSentences(insight.raw, 1) || insight.title,
    evidence: insight.evidence?.length ? insight.evidence : ['[Stuart to add: what actually happened that proves this]'],
    publicSafeVersion: conf.classification === 'public'
      ? core
      : `[Anonymise before use, suggested classification: ${conf.classification}] ${core.replace(/next\.io/gi, 'a B2B events business').replace(/[€£$]\s?\d[\d,.]*\s?(k|m|million)?/gi, 'a material sum')}`,
    contentAngles: [
      { format: 'linkedin-post', angle: `The operating lesson: ${insight.title}. Open with what you noticed, then what it means commercially for ${lanes[0] || 'founder-led B2B teams'}.` },
      { format: 'newsletter', angle: `Longer treatment: the pattern behind "${insight.title}" and the useful question a commercial leader should ask about it.` },
    ],
    outreachAngle: `A genuine reason to write to anyone wrestling with ${lanes[0] || 'this'}: share the observation, ask how they are seeing it. No pitch.`,
    speakingAngle: `Could anchor a talk segment on ${lanes[0] || 'commercial systems'} if two more concrete examples are added.`,
    commercialAngle: 'If a reader replies describing the same pain, that is a natural diagnostic conversation. Do not force it.',
    note: 'Mock provider output: a structured scaffold, not finished thinking. Edit before use.',
  };
}

// ---------------------------------------------------------------------------
// Channel specifications — the shape each platform demands. Used by the
// drafting prompt AND the mock scaffolds, so repurposing never copies the
// same text verbatim across platforms.
// ---------------------------------------------------------------------------
export const CHANNEL_SPECS = {
  'linkedin-post': { channel: 'LinkedIn', shape: '150-350 words, natural paragraphs, hook in the first two lines (before the fold), one question at the end if engagement is the goal, no more than one link.' },
  'x-post': { channel: 'X', shape: 'One post, under 280 characters. The single sharpest sentence of the idea, no hashtags, no thread unless asked.' },
  'x-thread': { channel: 'X', shape: 'A 4-7 post thread. Post 1 is the hook and must stand alone; one idea per post; each under 280 characters; final post lands the commercial read or the open question. Numbered n/ style.' },
  'substack-newsletter': { channel: 'Substack', shape: '600-1200 words. A subject line under 60 characters, a one-line preview, a lead that interprets one idea deeply, subheadings, a closing question inviting replies. More room for nuance and honest uncertainty than LinkedIn.' },
  'linkedin-newsletter': { channel: 'LinkedIn newsletter', shape: 'Like the Substack piece but 400-700 words, restructured (never pasted), with a title tuned for LinkedIn notification text.' },
  'linkedin-comment': { channel: 'LinkedIn', shape: 'One compact paragraph (two short at most). Congratulate warmly when deserved, then add one sharper angle or a real question. Never summarise the original post. No pitch.' },
  'forum-post': { channel: 'Prediction Markets Forum', shape: 'One compact context paragraph plus ONE clear practitioner question (what have you seen in practice / which risk gets underestimated / who should own this / does this add liquidity or distort). Never a repost of the LinkedIn copy, never a ticket-sales push, never several vague questions at once.' },
  'youtube-script': { channel: 'YouTube / short video', shape: 'A 60-90 second talking-head script: cold open on the observation, one concrete example, the commercial read, one line to camera. Written for speech, shorter sentences.' },
  'byline-article': { channel: 'Trade press', shape: '700-1000 words for an industry outlet: reported tone, operator evidence, no self-promotion beyond the byline; editors cut hype.' },
  'podcast-outline': { channel: 'Podcast', shape: 'Segment outline: 3 stories with the fix, each with the specific detail that makes it real. Bullet points, not prose.' },
  'speaking-proposal': { channel: 'Speaking', shape: 'Talk abstract (120 words) + 3 audience takeaways + why Stuart can give it. The audience should self-diagnose while listening.' },
};

// ---------------------------------------------------------------------------
// Content drafting. Channel-aware. Mock: honest scaffold in Stuart's
// structure with bracketed slots — never fabricated specifics. When
// sourceBody is passed (repurposing) the output must be a re-expression
// for the new channel, never the same text.
// ---------------------------------------------------------------------------
export async function draftContent({ title, format = 'linkedin-post', insight, pov, lanes = [], brand = 'stuart', sourceBody = null }) {
  const spec = CHANNEL_SPECS[format] || { channel: format, shape: 'Stuart\'s standard post structure.' };
  if (ANTHROPIC_KEY) {
    const system = `${prompt('content-drafting') || 'Draft in Stuart Crowley\'s voice.'}\n\n${voiceContext()}\nBritish English. No em dashes. Natural paragraphs. Do not fabricate statistics, clients or results.\nTarget format: ${spec.channel}. Shape: ${spec.shape}${sourceBody ? '\nYou are REPURPOSING an existing piece for a different platform: keep the idea, rebuild the expression for this format. Never reuse sentences verbatim.' : ''}`;
    const user = `Draft a ${format} for brand workspace "${brand}".\nTitle/idea: ${title}\nPoint of view: ${pov || 'none stated'}\nSource insight: ${insight ? `${insight.title}: ${insight.distilled?.publicSafeVersion || insight.raw}` : 'none'}${sourceBody ? `\nExisting piece to repurpose (do not copy verbatim):\n${sourceBody}` : ''}\nAuthority lanes: ${lanes.join(', ')}\nReturn only the draft text.`;
    try {
      const body = await callAnthropic(system, user, { maxTokens: format === 'substack-newsletter' ? 2500 : 1200 });
      return { provider: providerName(), body, lint: lint(body, { brand, kind: 'post' }) };
    } catch (err) { console.error('anthropic draft failed, using mock:', err.message); }
  }
  const source = insight?.distilled?.publicSafeVersion || insight?.distilled?.coreInsight || '';
  const core = sourceBody ? `[Re-express for ${spec.channel}, from the existing piece: ${sourceBody.slice(0, 160).replace(/\n/g, ' ')}...]` : (source || `[The observation in Stuart's words, from his own operating experience.]`);
  const commercial = `[Why this matters to ${lanes[0] || 'a founder-led B2B business'}: what breaks, what it costs, what fixing it buys.]`;
  const view = pov ? `My view, still forming: ${pov}` : `[Stuart's view. Fine to say it is still forming.]`;
  let body;
  switch (format) {
    case 'x-post':
      body = `[One sentence, under 280 chars, the sharpest version of: ${title}]`;
      break;
    case 'x-thread':
      body = [`1/ [Hook that stands alone: ${title}]`, `2/ ${core}`, `3/ ${commercial}`, `4/ ${view}`, `5/ [The open question to end on.]`].join('\n\n');
      break;
    case 'substack-newsletter':
      body = [`Subject: [under 60 chars, from: ${title}]`, `Preview: [one line]`, `[Lead: interpret the one idea deeply. ${core}]`, `## The commercial read\n${commercial}`, `## Where I land (for now)\n${view}`, `[Closing question inviting replies.]`].join('\n\n');
      break;
    case 'linkedin-newsletter':
      body = [`Title: [tuned for the LinkedIn notification, from: ${title}]`, core, commercial, view, `[Closing question.]`].join('\n\n');
      break;
    case 'youtube-script':
      body = [`[COLD OPEN, to camera: the observation in one breath: ${title}]`, `[EXAMPLE: one concrete story, 20 seconds.]`, `[THE READ: ${commercial}]`, `[CLOSE: one line, direct to camera.]`].join('\n\n');
      break;
    case 'byline-article':
      body = [`[Working headline: ${title}]`, `[Reported-tone opening: the pattern, not Stuart.]`, core, commercial, `[Operator evidence paragraph: what actually happened, anonymised.]`, `[Closing: the question the industry should be asking.]`].join('\n\n');
      break;
    default:
      body = [`[Hook, one or two lines: the specific thing noticed. Start from: ${title}]`, core, `The commercial read: ${commercial}`, view, `The useful question is [the question a commercial leader should ask themselves about this].`].join('\n\n');
  }
  return {
    provider: 'mock',
    body,
    lint: lint(body, { brand, kind: 'post' }),
    note: `Mock scaffold shaped for ${spec.channel} (${spec.shape}) Every bracketed slot needs Stuart's real material; nothing has been invented to fill it.`,
  };
}

// ---------------------------------------------------------------------------
// Outreach drafting. Uses only the evidence on the record. Mock output
// makes missing evidence loudly visible instead of inventing familiarity.
// ---------------------------------------------------------------------------
export async function draftOutreach({ contact, purpose, trigger, valueToRecipient, evidence = [], channel = 'linkedin-dm', brand = 'strait-up-growth' }) {
  if (ANTHROPIC_KEY) {
    const system = `${prompt('outreach-drafting') || ''}\n\n${voiceContext()}\nRules: no fake familiarity, no pressure, no long biography, one low-pressure ask, no em dashes, under 150 words for a DM. Use ONLY the evidence provided; if evidence is thin, say less, never invent.`;
    const user = `Draft a ${channel} message.\nRecipient: ${contact.name}, ${contact.role || ''} at ${contact.company || ''}.\nHow Stuart knows them: ${contact.howKnown || 'not recorded'}.\nPurpose: ${purpose}. Trigger: ${trigger || 'none'}.\nValue to them: ${valueToRecipient || 'unstated'}.\nEvidence: ${evidence.join(' | ') || 'none'}.\nReturn only the message.`;
    try {
      const body = await callAnthropic(system, user, { maxTokens: 500 });
      return { provider: providerName(), body, lint: lint(body, { brand, kind: 'outreach' }) };
    } catch (err) { console.error('anthropic outreach failed, using mock:', err.message); }
  }
  const known = contact.howKnown ? `` : `[No recorded history with ${contact.name}. Open plainly, do not manufacture familiarity.]\n\n`;
  const body = `${known}Hi ${contact.name.split(' ')[0]},\n\n${trigger ? `[Open from the trigger: ${trigger}]` : '[State the real reason for writing, in one line.]'}\n\n${valueToRecipient ? `[Make the value concrete: ${valueToRecipient}]` : '[What do they get from replying? If there is no honest answer, do not send this.]'}\n\n[One low-pressure ask: a short call, a reply with their view, or nothing at all this time.]\n\nStuart`;
  return {
    provider: 'mock',
    body,
    lint: lint(body, { brand, kind: 'outreach' }),
    note: 'Mock scaffold. Brackets mark what Stuart must supply; the engine will not invent personalisation.',
  };
}

// ---------------------------------------------------------------------------
// Weekly review draft (prompt E) — composed from real records.
// ---------------------------------------------------------------------------
export async function weeklyReviewDraft({ briefing, analytics }) {
  const insights = items('insights').filter((i) => (Date.now() - new Date(i.createdAt).getTime()) / 86400000 <= 7);
  const publicSafe = insights.filter((i) => (i.confidentiality?.classification || 'public') === 'public');
  const topLanes = (analytics.content.byLane || []).slice(0, 3).map((l) => l.lane);
  const neglected = (analytics.content.byLane || []).filter((l) => l.items === 0).map((l) => l.lane).slice(0, 3);

  const body = {
    weekOf: new Date().toISOString().slice(0, 10),
    workedOn: insights.map((i) => i.title),
    keepPrivate: insights.filter((i) => ['private-operating-lesson', 'strictly-confidential'].includes(i.confidentiality?.classification)).map((i) => i.title),
    publicSafeLessons: publicSafe.map((i) => i.title),
    recommendedTheme: topLanes[0] || 'commercial systems',
    contentIdeas: publicSafe.slice(0, 3).map((i) => `Post from "${i.title}" (${(i.lanes || [])[0] || 'unassigned lane'})`),
    longFormIdea: publicSafe[0] ? `Newsletter or article developing "${publicSafe[0].title}"` : 'No public-safe insight captured this week; capture before drafting.',
    relationshipActions: (analytics.relationships.goingCold || []).slice(0, 5).map((r) => `Reconnect with ${r.name} (${Math.round((Date.now() - new Date(r.last).getTime()) / 86400000)} days quiet)`),
    outreachOpportunities: briefing.allActions.filter((a) => ['approve-outreach', 'send-outreach', 'promote-engager'].includes(a.kind)).slice(0, 3).map((a) => a.title),
    speakingOrMediaAction: 'Review which published piece could become a talk abstract; none flagged automatically this week.',
    commercialAction: (analytics.pipeline.stale || [])[0] ? `Unstick "${analytics.pipeline.stale[0].name}" (${analytics.pipeline.stale[0].days} days idle)` : 'Advance the newest opportunity one concrete stage.',
    confidentialityWarnings: insights.filter((i) => i.confidentiality?.classification === 'strictly-confidential').map((i) => `"${i.title}" is strictly confidential; keep it out of all public material.`),
    stopDoing: briefing.stopDoing?.title || 'Nothing flagged this week.',
    neglectedLanes: neglected,
    provider: 'deterministic',
    note: 'Drafted from the week\'s records. Stuart edits and confirms; nothing here is auto-published.',
  };
  return body;
}
