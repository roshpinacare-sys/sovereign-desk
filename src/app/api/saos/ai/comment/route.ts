import { NextResponse } from "next/server";
import { commentLawGuard, llmComplete, SYMBOL_RULE, COMMENT_RULES } from "@/lib/saos-bridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

/**
 * SAOS AI BRIDGE — /api/saos/ai/comment
 *
 * The community lane (army-social.mjs draftCommentViaBridge) calls this to
 * write ONE substantive comment on a NON-fleet community post. Contract
 * (measured from the caller): POST {postTitle, postExcerpt, author,
 * personaBrief} → 200 {comment: {body}}. Same laws as the reply lane — the
 * body must clear the spamgate comment floor and every exposure/symbol law;
 * 503 lets the caller's breaker count honestly and the persona floor answer.
 */
export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const postTitle = String(payload.postTitle ?? "").slice(0, 300);
  const postExcerpt = String(payload.postExcerpt ?? "").slice(0, 1500);
  const author = String(payload.author ?? "the author").slice(0, 80);
  const personaBrief = String(payload.personaBrief ?? "").slice(0, 1600);

  if (!postTitle && !postExcerpt) {
    return NextResponse.json({ error: "empty-target" }, { status: 400 });
  }

  const system = [
    personaBrief ? `You are a real community member with this voice.\n${personaBrief}` : "You are a real community member.",
    "You are writing a comment on someone else's community post.",
    COMMENT_RULES,
    SYMBOL_RULE,
    "Engage with what THIS post actually says. Never mention being an AI, automation, or any internal system.",
  ].join("\n\n");

  const user = [
    `A community post by ${author}.`,
    postTitle ? `Title. ${postTitle}` : "",
    postExcerpt ? `Excerpt. ${postExcerpt.slice(0, 900)}` : "",
    "Write the comment body now. Only the body text, nothing else.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    let raw = await llmComplete(system, user);
    let guard = commentLawGuard(raw);
    if (!guard.ok) {
      const retryUser = `${user}\n\nYour previous draft was refused for these measured reasons. ${guard.reasons.join(", ")}. Write a corrected draft that satisfies every length and style law.`;
      raw = await llmComplete(system, retryUser);
      guard = commentLawGuard(raw);
    }
    if (!guard.ok) {
      return NextResponse.json({ error: "law-refused", reasons: guard.reasons }, { status: 503 });
    }
    return NextResponse.json({ comment: { body: guard.body } });
  } catch (e) {
    return NextResponse.json({ error: "bridge-failed", detail: String((e as Error)?.message ?? e).slice(0, 140) }, { status: 503 });
  }
}
