// Shared helpers for the @-mention feature: referencing a different chat
// thread from inside a message so the reader can jump straight there. A
// mention is stored inline in the message body as a small delimited token
// -- @{{<threadId>|<label>}} -- which ChatMessageBubble parses back into a
// clickable chip. The delimiters ({{ }}) don't otherwise appear in normal
// chat text, so this round-trips safely through plain-text storage.
// "thread" candidates jump straight to an existing chat and need no extra
// step. "referral" candidates are patients who have a referral but no
// dedicated chat thread yet -- picking one creates that thread on the fly.
// "new" is the always-available "start a brand new chat" action, using
// whatever the user typed after "@" as the topic. Both non-"thread" kinds
// resolve asynchronously (a network call happens before the mention token
// can be inserted), so callers must await `resolveMentionCandidate`-style
// logic rather than inserting a token immediately.
export type MentionCandidate =
  | { type: "thread"; id: number; label: string; kind: "general" | "referral" }
  | { type: "referral"; referralId: number; label: string }
  | { type: "new" };

export function threadMentionLabel(t: { kind: string; topic?: string | null }): string {
  if (t.kind === "referral") return `Referral: ${t.topic || "Untitled"}`;
  return t.topic || "General chat";
}

export function referralMentionLabel(r: { patientFirstName: string; patientLastName: string }): string {
  return `Referral: ${r.patientFirstName} ${r.patientLastName}`;
}

export function newChatMentionLabel(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `Start new chat: "${trimmed}"` : "Start new chat";
}

// Global-search-safe regex factory -- regex objects with the `g` flag carry
// mutable lastIndex state, so callers that might re-enter (e.g. React
// re-renders) must get a fresh instance rather than sharing one at module
// scope.
export function mentionTokenRegex(): RegExp {
  return /@\{\{(\d+)\|([^}]*)\}\}/g;
}

export function formatMentionToken(id: number, label: string): string {
  // Strip any stray "}" from the label so it can't prematurely close the
  // token -- labels come from topic text a user typed elsewhere, not from
  // this message body, so this is a defensive precaution, not a real path.
  return `@{{${id}|${label.replace(/[{}]/g, "")}}}`;
}

// Finds an in-progress "@query" the caret currently sits inside of, if any.
// A mention only starts at the beginning of the text or right after
// whitespace, and it can't already contain a space -- so "call@work" and
// "already sent @ 3pm see you" don't trigger it, but "hey @jo" does.
export function findActiveMention(text: string, caret: number): { start: number; query: string } | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  const query = upToCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  const before = at === 0 ? "" : upToCaret[at - 1];
  if (before && !/\s/.test(before)) return null;
  return { start: at, query };
}
