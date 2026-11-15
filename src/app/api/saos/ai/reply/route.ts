import { NextResponse } from "next/server";
import { commentLawGuard, llmComplete, SYMBOL_RULE, COMMENT_RULES } from "@/lib/saos-bridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

/**
 * SAOS AI BRIDGE — /api/saos/ai/reply
 *
 * The social engine's reply lane (army-social.mjs draftReplyViaBridge) calls
 * this route to answer a comment on a fleet thread. Contract (measured from
 * the caller): POST {postTitle, postExcerpt, commentAuthor, commentBody,
 * myPrior, personaBrief} → 200 {reply: {body}} — the body must clear the
 * engine's spamgate (steem comment floor 200 normalized chars) and every
 * exposure/symbol law on ITS side; this route enforces the same laws first
 * so a returned body always survives the door. 503 on any failure — the
 * caller's bridge-guard counts it honestly and the lawful persona floor
 * takes over (fail-closed, never a fabricated body).
 */
export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const postTitle = String(payload.postTitle ?? "").slice(0, 300);
  const postExcerpt = String(payload.postExcerpt ?? "").slice(0, 1200);
  const commentAuthor = String(payload.commentAuthor ?? "").slice(0, 80);
  const commentBody = String(payload.commentBody ?? "").slice(0, 2000);
  const myPrior = String(payload.myPrior ?? "").slice(0, 1200);
  const personaBrief = String(payload.personaBrief ?? "").slice(0, 1600);

  if (!commentBody && !postTitle) {
    return NextResponse.json({ error: "empty-target" }, { status: 400 });
  }

  const system = [
    personaBrief ? `You are a real community member with this voice.\n${personaBrief}` : "You are a real community member.",
    "You are writing a reply comment on a discussion thread.",
    COMMENT_RULES,
    SYMBOL_RULE,
    "Never mention being an AI, automation, accounts being connected, or any internal system.",
  ].join("\n\n");

  const user = [
    postTitle ? `The thread's post title. ${postTitle}` : "",
    postExcerpt ? `The post excerpt. ${postExcerpt.slice(0, 600)}` : "",
    `The comment you are replying to, written by ${commentAuthor || "a reader"}.`,
    commentBody,
    myPrior ? `What you already said earlier in this thread (do not repeat it). ${myPrior.slice(0, 600)}` : "",
    "Write the reply body now. Only the body text, nothing else.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    let raw = await llmComplete(system, user);
    let guard = commentLawGuard(raw);
    if (!guard.ok) {
      /* one honest retry with the measured reasons as feedback */
      const retryUser = `${user}\n\nYour previous draft was refused for these measured reasons. ${guard.reasons.join(", ")}. Write a corrected draft that satisfies every length and style law.`;
      raw = await llmComplete(system, retryUser);
      guard = commentLawGuard(raw);
    }
    if (!guard.ok) {
      return NextResponse.json({ error: "law-refused", reasons: guard.reasons }, { status: 503 });
    }
    return NextResponse.json({ reply: { body: guard.body } });
  } catch (e) {
    return NextResponse.json({ error: "bridge-failed", detail: String((e as Error)?.message ?? e).slice(0, 140) }, { status: 503 });
  }
}
