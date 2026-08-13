import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Legacy partner/student records sometimes carry an academic title in the
// name field (e.g. "Dr. Sara Novak", "Prof. Jane Doe"). A naive first-token
// split would greet them as "Welcome back, Dr." with no actual name. Strip
// known title prefixes before taking the first name.
const NAME_TITLE_PREFIXES = ["dr.", "dr", "prof.", "prof", "mag.", "ing.", "mr.", "mrs.", "ms."];

export function firstNameOf(fullName: string | undefined | null): string {
  if (!fullName) return "";
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && NAME_TITLE_PREFIXES.includes(tokens[0].toLowerCase())) {
    tokens.shift();
  }
  return tokens[0] ?? "";
}

// Greets partners with their academic title + surname rather than a bare
// first name (e.g. "Dr. Baeumer" instead of "Christoph"). Handles titles
// glued to the next word without a space (legacy WP data, e.g. "Dr.Dietsche").
// Falls back to the surname alone when no known title is present, and to the
// original string when no surname can be confidently identified.
export function titleAndSurnameOf(fullName: string | undefined | null): string {
  if (!fullName) return "";
  const rawTokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return "";

  const tokens: string[] = [];
  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    const matchedPrefix = NAME_TITLE_PREFIXES.find(
      (p) => lower.startsWith(p) && lower.length > p.length && /[a-z]/i.test(token[p.length])
    );
    if (matchedPrefix) {
      tokens.push(token.slice(0, matchedPrefix.length), token.slice(matchedPrefix.length));
    } else {
      tokens.push(token);
    }
  }

  let title: string | null = null;
  const remaining: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!title && NAME_TITLE_PREFIXES.includes(lower)) {
      const normalized = /\.$/.test(token) ? token : `${token}.`;
      title = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    } else {
      remaining.push(token);
    }
  }

  const surname = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  if (title && surname) return `${title} ${surname}`;
  if (surname) return surname;
  return fullName.trim();
}
