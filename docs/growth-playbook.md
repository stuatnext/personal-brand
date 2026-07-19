# Stuart's LinkedIn + X growth playbook (personal brand, not summit-only)

Written 2026-07-19. The goal is durable authority + optionality (consultancy pipeline,
ventures, speaking) with the NEXTPredict summit (22-23 Oct 2026) as one catalyst inside it,
not the finish line. Grow Stuart's PERSONAL accounts; the brand handles amplify.

> Confidence note: the strategic principles below are durable and well-evidenced. The exact
> 2026 algorithm weights (link penalties, ranking signals) shift month to month — verify any
> single mechanic against current LinkedIn/X creator guidance before treating it as gospel.
> This was written from domain knowledge, not a live research sweep (kept lean on purpose).

## The throughline (what ties three pillars into one person)
Stuart reads and builds the **serious operating layer of fast-moving markets** — the
commercial and market-structure lens. That single identity connects all three pillars:
- **Strait Up Growth** — commercial/AI/ops for growth companies (Singapore & SEA).
- **Prediction markets** — the operating layer of a brand-new category (NEXTPredict).
- **iGaming & sports betting** — the industry he came from; market structure + commercialisation.
One-line bio test: "I help build the commercial and operating layer of new markets."
Every post should be recognisably from that person, whatever the pillar.

## Pillar mix (ratios, not vibes)
Currently the schedule is ~100% NEXTPredict. Rebalance to:
- **Now → summit (Jul-Oct, lean into the catalyst):** PM/NEXTPredict 55%, Strait Up Growth 25%,
  iGaming/NEXT.io 12%, personal/meta 8%.
- **Post-summit (shift to the durable engine):** Strait Up Growth 40%, PM 35%, iGaming 15%,
  personal 10%.
`lanes.json` already tiers these three pillars (core vs supporting); these ratios operationalise it.

## Platform mechanics (do this)
**LinkedIn** (B2B decision-makers + sponsors live here):
- First 2 lines are the hook (everything before "see more"). Open on a tension or a concrete
  detail, never a warm-up.
- No outbound link in the body — link goes in the FIRST comment (the engine already enforces this).
- Comments outrank likes for reach. Reply to every comment in the first 60-90 min (the golden
  window). Post when your audience is awake (US/EU business hours for this audience).
- Documents/carousels and strong-POV native text outperform; native video is rising; polls sparingly.
- ~4-5x/week, sustainable. Consistency beats volume.

**X** (category-native, fast news cycle, operators/quants):
- Strong standalone first post. Threads for depth; put any link/CTA in a reply, not the first post.
- Bookmarks + replies + reposts are the signals that travel; quote-tweet the day's category news fast.
- 1-3x/day is fine. Topical consistency teaches the "for you" graph what you're for.

## The daily engagement routine (the single biggest growth lever, ~25 min/day)
Founder growth in a niche comes less from your own posts than from **borrowing the right
audiences**. Every day, leave 5-8 substantive comments (a real added point, never "great post")
on posts from the people we already track:
- Operators: Kalshi / Polymarket / Rothera / Pascal leadership.
- The PM press corps: Katherine Long, Caitlin Ostroff, Lydia Beyoud, Kate Knibbs, Dan Primack,
  Bobby Allyn (now in `data/connectors.json` in nextpredict-engine).
- Ex-regulators / analysts / investors we've routed.
This builds both reach AND the relationships that convert to sponsor/attendee conversations.
The rotating target list already lives in `data/connectors.json` + `data/registry/people.json`.

## The 12-week reach → convert arc (summit is a peak, not the end)
- **Weeks 1-4 (reach/authority):** news-jack the day's category moves + POV/analysis; heavy
  commenting; establish the throughline. Watch: follower growth, profile views, qualified comments.
- **Weeks 5-8 (authority → interest):** teardowns, build-in-public on the summit, soft first
  speaker/attendee reveals, open a waitlist/updates list. Watch: waitlist signups, DMs, saves.
- **Weeks 9-12 (convert):** agenda + "who's in the room" reveals as social proof; soft, exploratory
  ticket + sponsor asks (never a hard sell); DM motion to warm engagers. Watch: tickets, sponsor calls.
- **Post-summit:** recap + insight content, then tilt the mix toward the Strait Up Growth
  consultancy pillar. The audience you built keeps paying out — that's the whole point.

## Account structure
ONE personal account per platform, one throughline; the NEXTPredict brand handle reposts/amplifies.
Do NOT split into per-pillar accounts now — it halves the follower asset and doubles the effort.
Revisit a dedicated Strait Up Growth handle only post-summit if the consultancy pillar earns it.

## The iGaming reputational call
iGaming is a real pillar and its vocabulary is fine on Stuart-personal / NEXT.io. But over-indexing
it during the summit runway can muddy the serious-institutional PM positioning (PM's pitch is "we
are NOT gambling"). So keep iGaming lighter now (12%), framed as commercial/market-structure
analysis from an operator's lens, never punting. Keep NEXTPredict copy strictly clean
(`lib/voice.mjs` enforces the per-brand ban). Rebalance iGaming up after October.

## What to avoid (credibility matters more than vanity for this audience)
- Outbound links in the post body; engagement-bait ("comment X to get Y"); hype words.
- Buying followers or joining engagement pods — real algo-penalty + credibility risk with an
  institutional audience.
- Over-automation, and posting identical copy to both platforms (repurpose per platform — the
  engine already forbids duplicate copy).

## How this maps to the repo (execution)
- `data/lanes.json` — pillar tiers (already there).
- `data/calendar.json` — currently 100% NEXTPredict; fill Strait Up Growth + iGaming slots to the
  mix above (the execution step).
- `scripts/ideas-bank.mjs` / `data/strategy.json` — feed the pillar ratios so the 7-day plan and
  idea bank stop being PM-only.
- NEXTPredict Master Social Schedule (nextpredict-engine) — the PM pillar's feed into this.
- `data/connectors.json` + `data/registry/people.json` (nextpredict-engine) — the engagement-routine
  target list.
