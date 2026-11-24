type Author = {
  senderId: number;
  senderRole: string;
  senderName: string;
  sharedAuthor?: boolean;
  unverifiedGuestHistory?: boolean;
};

// The server records the author's role/ID on write (including invitation
// transfer). Never infer a person from text, contact details or a display name.
export function isMahaAuthor(m: Author) {
  return m.senderRole === "admin" && !m.sharedAuthor;
}

export function chatAuthorName(m: Author) {
  const name = m.senderName?.trim();
  if (m.unverifiedGuestHistory) return "Guest (before account verification)";
  if (isMahaAuthor(m)) return m.senderId > 0 && name ? name : "MAHA team";
  if (m.sharedAuthor) return name || "Shared guest";
  if (m.senderRole === "guest") return name || "Guest";
  if (m.senderRole === "partner") return name || "Partner";
  if (m.senderRole === "student") return name || "Student";
  return "Unverified sender";
}

export function chatAuthorLabel(m: Author, mine: boolean) {
  const namedStaff = isMahaAuthor(m) && m.senderId > 0 && m.senderName?.trim();
  return chatAuthorName(m) + (mine ? " (you)" : "") + (namedStaff ? " · MAHA" : "");
}
