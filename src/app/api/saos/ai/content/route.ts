import { NextResponse } from "next/server";
import { symbolLaw, normalizeForMeasure, llmComplete, SYMBOL_RULE } from "@/lib/saos-bridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

/**
 * SAOS AI BRIDGE — /api/saos/ai/content
 *
 * The writers' room (content.mjs) calls this to draft queue posts. Contract
 * (measured from the caller): POST {topics, voices, personas, recentTitles,
 * findings, exposureLaw, styleLaw, formatLaw} → 200 {drafts: [{title, body,
 * tags, angle, voice, seoNote, groundedOn}]}. Engine-side sanitizeDraft
 * demands: title ≥12 chars, body ≥300 words, 2-5 clean tags, symbol law
 * clean, no banned words, no generic AI openers, ≥1 grounded reference
 * (spamgate minGroundedRefs) — this route enforces the same laws and only
 * returns drafts that will survive the door. Fail-closed: a failed round
 * returns fewer (or zero) drafts, never fabricated ones.
 */

const BANNED = [
  "headcorner", "saos", "צבא", "army of accounts", "our accounts",
  "multi-account", "we control", "our fleet", "guaranteed profit",
  "price target", "financial advice", "in today's world", "in conclusion",
];

const GENERIC_OPENERS = [
  "in an era of", "in the digital age", "in today's fast-paced", "have you ever wondered",
  "imagine a world", "the world of", "unlock the power", "delve into", "dive deep into",
  "a comprehensive guide", "the ultimate guide", "everything you need to know",
];

type Draft = {
  title: string;
  body: string;
  tags: string[];
  angle?: string | null;
  voice?: string | null;
  seoNote?: string | null;
  groundedOn?: string[];
};

function cleanTags(tags: unknown): string[] {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24))
    .filter(Boolean)
    .slice(0, 5);
}

function wordCount(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

function draftLawGuard(d: Record<string, unknown>): Draft | null {
  const title = symbolLaw(String(d.title ?? "").trim(), { protectUrls: false });
  const body = symbolLaw(String(d.body ?? "").trim(), { protectUrls: true });
  if (title === null || body === null) return null;
  if (title.length < 12 || title.length > 160) return null;
  if (wordCount(body) < 300) return null;
  const tags = cleanTags(d.tags);
  if (tags.length < 2) return null;
  const blob = `${title}\n${body}`.toLowerCase();
  if (BANNED.some((w) => blob.includes(w))) return null;
  const open = `${title.toLowerCase()}\n${body.slice(0, 140).toLowerCase()}`;
  if (GENERIC_OPENERS.some((g) => open.includes(g))) return null;
  if (normalizeForMeasure(body).length < 1200) return null;
  const groundedOn = (Array.isArray(d.groundedOn) ? d.groundedOn : [])
    .map((g) => String(g).slice(0, 160))
    .filter(Boolean)
    .slice(0, 4);
  if (groundedOn.length < 1) return null; // spamgate minGroundedRefs = 1
  return {
    title: title.slice(0, 160),
    body: body.slice(0, 8000),
    tags,
    angle: String(d.angle ?? "").slice(0, 300) || null,
    voice: String(d.voice ?? "").slice(0, 300) || null,
    seoNote: String(d.seoNote ?? "").slice(0, 300) || null,
    groundedOn,
  };
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const topics = Array.isArray(payload.topics) ? payload.topics.map(String).slice(0, 12) : [];
  const voices = Array.isArray(payload.voices) ? payload.voices.map(String).slice(0, 8) : [];
  const personas = Array.isArray(payload.personas) ? payload.personas.map(String).slice(0, 16) : [];
  const recentTitles = Array.isArray(payload.recentTitles) ? payload.recentTitles.map(String).slice(0, 30) : [];
  const findings = Array.isArray(payload.findings) ? payload.findings.map(String).slice(0, 20) : [];

  if (!topics.length) {
    return NextResponse.json({ error: "no-topics" }, { status: 400 });
  }

  const system = [
    "You are a professional writer producing original community posts for a blockchain blogging platform.",
    "Hard laws for every draft.",
    `1. Body length between 340 and 500 words, structured with short paragraphs. First paragraph must stand alone.`,
    `2. Title between 12 and 100 characters, concrete curiosity, never clickbait, never generic.`,
    `3. Exactly 3 to 5 topical lowercase tags, no hashtag symbols, each under 24 chars.`,
    `4. Every draft must be grounded in at least one of the provided findings, and you must list the finding(s) it used in a groundedOn array, quoting the finding.`,
    `5. ${SYMBOL_RULE} This includes the title and the body.`,
    `6. Markdown allowed (headings, bold, lists). No images, no URLs in the body.`,
    `7. Never mention AI, automation, coordinated accounts, or any internal system. No financial advice, no price predictions.`,
    `8. If recent titles are provided, the new titles must be clearly different from all of them.`,
    "Return STRICT JSON only, no prose, no code fence. Shape {\"drafts\":[{\"title\",\"body\",\"tags\":[...],\"angle\",\"voice\",\"seoNote\",\"groundedOn\":[...]}]} with exactly 3 drafts.",
  ].join("\n");

  const user = [
    `Topics to draw from. ${topics.join(" | ")}`,
    voices.length ? `Voices available. ${voices.join(" | ")}` : "",
    personas.length ? `Persona notes. ${personas.join(" | ").slice(0, 2000)}` : "",
    findings.length ? `Measured findings you may ground on (quote the one you use). ${findings.map((f) => `- ${f.slice(0, 240)}`).join("\n")}` : "",
    recentTitles.length ? `Titles already published recently, yours must differ. ${recentTitles.join(" | ").slice(0, 1500)}` : "",
    "Write the 3 drafts now as strict JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await llmComplete(system, user, 240_000);
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return NextResponse.json({ error: "no-json" }, { status: 503 });
    }
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as { drafts?: unknown[] };
    const drafts = (Array.isArray(parsed.drafts) ? parsed.drafts : [])
      .map((d) => draftLawGuard(d as Record<string, unknown>))
      .filter((d): d is Draft => d !== null);
    /* fail-honest: return only what cleared the laws, even if that is fewer than asked */
    return NextResponse.json({ drafts });
  } catch (e) {
    return NextResponse.json({ error: "bridge-failed", detail: String((e as Error)?.message ?? e).slice(0, 140) }, { status: 503 });
  }
}
