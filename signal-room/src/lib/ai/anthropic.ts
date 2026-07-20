import type { DraftContext, EditorialContext, LLMProvider } from "./provider";
import { STUART_VOICE_SYSTEM, EDITORIAL_SYSTEM, draftUserPrompt } from "./prompts";
import { lintVoice } from "@/lib/voice/lint";

// Real provider. Only active when ANTHROPIC_API_KEY is set. The editorial
// model (strongest) handles judgement and drafting; the extraction model
// slot exists for cheap mechanical refinement. Calls carry a hard timeout
// and retry transient failures (429/5xx/network) with backoff, because the
// first live failure mode of any provider integration is a hung request.

const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callClaude(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 1200,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => "");
        lastError = new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(res.headers.get("retry-after")) || attempt * 2;
          await sleep(retryAfter * 1000);
          continue;
        }
        throw lastError;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { content: { type: string; text?: string }[] };
      return data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n")
        .trim();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`Anthropic API timed out after ${TIMEOUT_MS / 1000}s`);
      } else if (err instanceof Error) {
        lastError = err;
      } else {
        lastError = new Error(String(err));
      }
      // non-HTTP failures (network, timeout) retry too
      if (attempt < MAX_ATTEMPTS && !/API 4\d\d/.test(lastError.message)) {
        await sleep(attempt * 2000);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("Anthropic call failed");
}

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  isReal = true;

  private editorialModel = process.env.SIGNAL_ROOM_EDITORIAL_MODEL || "claude-opus-4-8";

  async generateDraft(ctx: DraftContext): Promise<string> {
    const evidenceBlock = ctx.allowedEvidence
      .map((e, i) => `[E${i + 1}] (${e.status}) ${e.attribution}: "${e.excerpt}"`)
      .join("\n");
    const user = draftUserPrompt({ ...ctx, evidenceBlock });
    let draft = await callClaude({
      model: this.editorialModel,
      system: STUART_VOICE_SYSTEM,
      user,
    });

    // One corrective pass if the draft trips the voice linter.
    const lint = lintVoice(draft, {
      outreach: ["dm", "email", "forum_post"].includes(ctx.draftType),
      hasUnverifiedClaims: ctx.hasUnverifiedClaims,
    });
    if (lint.errors.length > 0) {
      const problems = lint.errors.map((e) => `- ${e.rule}: "${e.match}" (${e.message})`).join("\n");
      draft = await callClaude({
        model: this.editorialModel,
        system: STUART_VOICE_SYSTEM,
        user: `${user}\n\nYour previous attempt violated Stuart's voice rules:\n${problems}\n\nRewrite the draft fixing every violation. Return only the draft text.`,
      });
    }
    return draft;
  }

  async refineEditorial(ctx: EditorialContext): Promise<{ rationale: string; angle: string } | null> {
    const evidence = ctx.evidence
      .map((e, i) => `[E${i + 1}] (${e.status}) ${e.attribution}: "${e.excerpt}"`)
      .join("\n");
    const text = await callClaude({
      model: this.editorialModel,
      system: EDITORIAL_SYSTEM,
      maxTokens: 700,
      user: `Story: ${ctx.clusterTitle}

Heuristic recommendation rationale: ${ctx.heuristicRationale}
Heuristic Stuart angle: ${ctx.heuristicAngle}

Evidence:
${evidence}

Rewrite the rationale (2-3 sentences) and the "why Stuart has an angle" note (2-3 sentences) so they are specific to this evidence, honest about uncertainty, and free of generic phrasing. Respond exactly as:
RATIONALE: <text>
ANGLE: <text>`,
    });
    const rationale = text.match(/RATIONALE:\s*([\s\S]*?)(?=\nANGLE:|$)/)?.[1]?.trim();
    const angle = text.match(/ANGLE:\s*([\s\S]*)$/)?.[1]?.trim();
    if (rationale && angle) return { rationale, angle };
    return null;
  }
}
