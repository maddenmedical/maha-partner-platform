import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Dashboard greeting name, built from the structured profile fields rather
// than parsing the free-text `name` string — this keeps academic prefix
// titles (e.g. "Dr.", "Prof. Dr.") and post-nominal credentials (e.g. "DDS,
// PhD", stored separately as `suffix`) from ever leaking into each other.
// Rule: prefix title present -> "{prefix} {lastName}"; otherwise
// -> "{firstName} {lastName}". Post-nominals are never included.
export function getGreetingName(user: {
  prefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
}): string {
  const prefix = user.prefix?.trim();
  const firstName = user.firstName?.trim();
  const lastName = user.lastName?.trim();

  if (prefix && lastName) {
    return `${prefix} ${lastName}`;
  }
  const joined = [firstName, lastName].filter(Boolean).join(" ");
  if (joined) return joined;
  // Legacy/migrated accounts without structured name fields: fall back to
  // whatever is in the free-text name rather than showing nothing.
  return user.name?.trim() ?? "";
}
