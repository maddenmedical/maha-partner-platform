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

// Shortens a display name for tight single-line contexts (e.g. a composer
// placeholder like "Message {name}...") where the full free-text name --
// which often carries post-nominal credentials, e.g. "Dr. Sebastjan Perko,
// DDS., PhD." -- would wrap to a second line and get clipped by whatever
// fixed-height/viewport-edge container holds it. Drops everything after the
// first comma (the credentials) first, since that's almost always what's
// making these names long; falls back to a hard character cap for the rare
// name that's still too long even without credentials.
export function shortenNameForFit(name: string, maxLen = 22): string {
  const trimmed = name.trim();
  const beforeComma = trimmed.split(",")[0].trim();
  const base = beforeComma.length > 0 ? beforeComma : trimmed;
  if (base.length <= maxLen) return base;
  return base.slice(0, maxLen).trimEnd() + "\u2026";
}
