/**
 * SAOS AI BRIDGE — the LLM writer's room, laws baked in (bridge rebuild 2026-11-15).
 *
 * Measured root cause this rebuild answers: the social rail stalled at
 * SOCIAL-IDLE / spamgate.refused "body-too-thin(194<200)" because the bridge
 * routes (/api/saos/ai/reply|comment|content) were missing from the machine
 * after the wipe — bridge-guard state failStreak 66, ECONNREFUSED — and the
 * offline persona floor drafts 180-199 char bodies that die at the measured
 * 200-char spamgate floor (steem) / 260 (hive) / 300 (blurt).
 *
 * Law sources (mirrored from the engine tree, one truth per law):
 *   · SYMBOL LAW (R283): em/en dashes, double quotes, colons NEVER ship.
 *     Dashes rewrite to comma pauses, quotes drop, colons to periods; a
 *     survivor that still carries a banned glyph is REFUSED (fail-closed).
 *   · SPAMGATE (R243): steem comment floor 200 normalized chars (measured
 *     @spaminator victims were 8-130 chars), post floor 1200; hive/blurt
 *     stricter. The bridge targets comfortable headroom (280-450 raw for
 *     comments) so the engine's own gate never has to rescue a draft.
 *   · EXPOSURE LAW: no roster names, no coordination hints, no financial
 *     advice, no URLs in comments/replies, no template praise openers.
 *
 * z-ai-web-dev-sdk is used SERVER-SIDE ONLY (the engine calls these routes
 * from its beat; no browser ever sees them).
 */

import ZAI from "z-ai-web-dev-sdk";

/* ── ROSTER + BANNED VOCABULARY (mirror of army-social sanitizeReply) ────── */

const ROSTER = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "hcsoldier",
];

const BANNED_PHRASES = [
  "saos", "צבא", "our accounts", "multi-account", "we control", "our fleet",
  "guaranteed profit", "price target", "financial advice", "in today's world",
  "in conclusion",
];

const TEMPLATE_OPENERS = [
  "that's a great", "that is a great", "great point", "great post",
  "i completely agree", "thanks for sharing", "well said", "amazing post",
  "beautiful post", "fascinating", "wonderful", "nice post", "good post",
  "awesome post", "i love this",
];

const SYMBOL_LAW_BANNED = /[\u2014\u2013\u2012\u2015:"\u201c\u201d]/;

/* ── SYMBOL LAW (mirror of content.mjs enforceSymbolLaw) ─────────────────── */

export function symbolLaw(text: string, opts: { protectUrls?: boolean } = {}): string | null {
  let t = String(text ?? "");
  if (!t) return "";
  if (opts.protectUrls) {
    const urls: string[] = [];
    t = t.replace(/\]\(([^)\s]+)\)/g, (_m, u: string) => { urls.push(u); return `]\u0000${urls.length - 1}\u0000)`; });
    t = t.replace(/\bhttps:\/\/[^\s)]+/g, (u) => { urls.push(u); return `\u0000${urls.length - 1}\u0000`; });
    t = t
      .replace(/(\s*)[\u2014\u2013\u2012\u2015](\s*)/g, ", ")
      .replace(/["\u201c\u201d]/g, "")
      .replace(/:\s*([a-z])/g, (_m, c: string) => `. ${c.toUpperCase()}`)
      .replace(/(\s*):(\s*)/g, ". ")
      .replace(/\s+([.,])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (SYMBOL_LAW_BANNED.test(t)) return null;
    return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `${urls[Number(i)] ?? ""}`);
  }
  /* comments/replies: URLs are banned outright, no protection needed */
  t = t
    .replace(/(\s*)[\u2014\u2013\u2012\u2015](\s*)/g, ", ")
    .replace(/["\u201c\u201d]/g, "")
    .replace(/:\s*([a-z])/g, (_m, c: string) => `. ${c.toUpperCase()}`)
    .replace(/(\s*):(\s*)/g, ". ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (SYMBOL_LAW_BANNED.test(t)) return null;
  return t;
}

/* ── SPAMGATE MEASURE (mirror of spamgate.mjs normalizeText) ─────────────── */

export function normalizeForMeasure(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!+\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_~`>|]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsRoster(low: string): boolean {
  return ROSTER.some((n) => new RegExp(`(^|[^a-z0-9])${n}([^a-z0-9]|$)`).test(low));
}

/* ── COMMENT/REPLY GUARD — everything the engine's door will check ───────── */

export type GuardResult = { ok: true; body: string } | { ok: false; reasons: string[] };

export function commentLawGuard(raw: string, floor = 200): GuardResult {
  const reasons: string[] = [];
  const body = symbolLaw(raw);
  if (body === null) return { ok: false, reasons: ["symbol-law"] };
  const trimmed = body.trim().replace(/\s+/g, " ");
  if (trimmed.length < 240 || trimmed.length > 700) reasons.push(`raw-length(${trimmed.length})`);
  const normalized = normalizeForMeasure(trimmed);
  if (normalized.length < floor + 10) reasons.push(`normalized-thin(${normalized.length}<${floor + 10})`);
  const low = trimmed.toLowerCase();
  if (mentionsRoster(low) || BANNED_PHRASES.some((p) => low.includes(p))) reasons.push("exposure");
  if (low.includes("http://") || low.includes("https://")) reasons.push("url");
  const head = low.slice(0, 90);
  if (TEMPLATE_OPENERS.some((t) => head.includes(t))) reasons.push("template-opener");
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const nset = new Set(sentences.map((s) => s.trim().toLowerCase()));
  if (nset.size < sentences.length * 0.6) reasons.push("dup-sentences");
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, body: trimmed };
}

/* ── LLM CORE — one completion, honest errors ─────────────────────────────── */

export async function llmComplete(system: string, user: string, timeoutMs = 75_000): Promise<string> {
  const attempt = async (): Promise<string> => {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        { role: "user", content: user },
      ],
      thinking: { type: "disabled" },
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content || !content.trim()) throw new Error("empty-completion");
    return content.trim();
  };
  try {
    return await attempt();
  } catch (e) {
    /* R-429 2026-11-15 · measured: the provider rate-limits in bursts
     * ("Too many requests"). One backoff retry inside the route (25s) lets a
     * transient storm pass without surfacing a 503 to the engine's breaker —
     * the caller's own retry + circuit breaker stay the outer defenses. */
    const msg = String((e as Error)?.message ?? e);
    if (/429|too many requests/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 25_000));
      return await attempt();
    }
    throw e;
  }
}

/* ── SHARED SYSTEM-LAW BLOCKS (the writer reads them every call) ──────────── */

export const SYMBOL_RULE = [
  "NEVER use em dashes, en dashes, double quotes, or colons anywhere in the text.",
  "Write with periods, commas, and parentheses only. This is a hard law.",
].join(" ");

export const COMMENT_RULES = [
  "Length law. The body must be between 280 and 450 characters (with spaces), one paragraph, no line breaks.",
  "Open by engaging the specific point the person made, never with generic praise.",
  "Add one concrete substantive angle they did not mention.",
  "End with a natural question that invites their answer.",
  "Plain text only. No URLs, no markdown, no emoji, no hashtags.",
  "Write in English, conversational and specific, like a real community member who read the piece.",
].join(" ");
