import type { CaseDiscussion } from "@shared/schema";

// Escape a text value per RFC 5545: backslash, comma, semicolon are escaped,
// and newlines become the literal two-character sequence "\n".
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

// Convert epoch ms to a UTC ICS timestamp: YYYYMMDDTHHMMSSZ.
function toIcsUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

const ONE_HOUR_MS = 60 * 60 * 1000;

// Build a minimal valid single-VEVENT ICS for a case discussion. Assumes a
// 1-hour duration since no end time is modeled. Uses CRLF line endings as
// required by RFC 5545.
export function buildCaseDiscussionIcs(discussion: CaseDiscussion): string {
  const dtStamp = toIcsUtc(Date.now());
  const dtStart = toIcsUtc(discussion.scheduledAt);
  const dtEnd = toIcsUtc(discussion.scheduledAt + ONE_HOUR_MS);

  const summary = escapeText(discussion.topic);
  const descriptionParts: string[] = [];
  if (discussion.presenterName) descriptionParts.push(`Presenter: ${discussion.presenterName}`);
  if (discussion.notes) descriptionParts.push(discussion.notes);
  descriptionParts.push(`Join via Zoom: ${discussion.zoomLink}`);
  const description = escapeText(descriptionParts.join("\n\n"));
  const location = escapeText(discussion.zoomLink);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MAHA Clinic//Partner Portal//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:case-discussion-${discussion.id}@maha.clinic`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `URL:${discussion.zoomLink}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n") + "\r\n";
}
