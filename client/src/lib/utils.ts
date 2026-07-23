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
