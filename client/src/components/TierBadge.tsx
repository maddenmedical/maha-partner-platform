import { Award } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StandingTierKey } from "@shared/schema";

// Visual treatment for each MAHA Standing tier. "newcomer" intentionally
// renders nothing -- everyone starts there, so a badge would just single out
// new members rather than signal an earned status. Points and how they're
// earned are never shown here; this is the tier label only (see
// shared/schema.ts STANDING_TIERS note on internal-only points).
const TIER_STYLES: Partial<Record<StandingTierKey, string>> = {
  active_member: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  connector: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900",
  mentor: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900",
  maha_fellow: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
};

export function TierBadge({
  tierKey,
  tierLabel,
  className,
}: {
  tierKey?: string | null;
  tierLabel?: string | null;
  className?: string;
}) {
  if (!tierKey || !tierLabel || !(tierKey in TIER_STYLES)) return null;
  const style = TIER_STYLES[tierKey as StandingTierKey];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-[1px] text-[10px] font-medium leading-tight whitespace-nowrap",
        style,
        className
      )}
      data-testid={`badge-tier-${tierKey}`}
      title={tierLabel}
    >
      <Award className="h-2.5 w-2.5" />
      {tierLabel}
    </span>
  );
}
