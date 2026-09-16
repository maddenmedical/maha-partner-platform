import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TierBadge } from "@/components/TierBadge";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

type LevelRow = { key: string; label: string; minPoints: number };

// Names + point thresholds ONLY. This dialog fetches from a sanitized
// backend endpoint (/api/standing/tiers) rather than importing STANDING_TIERS
// client-side, so the reward field can never end up in this bundle -- see
// "We don't want any rewards at all" in project rules. Do not add reward
// text here under any circumstance.
export function PartnerLevelsDialog({
  currentTierKey,
  trigger,
}: {
  currentTierKey?: string | null;
  trigger?: ReactNode;
}) {
  const { data: levels, isLoading } = useQuery<LevelRow[]>({
    queryKey: ["/api/standing/tiers"],
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="h-auto p-0 text-xs underline underline-offset-2" data-testid="button-view-all-levels">
            View all levels
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm" data-testid="dialog-partner-levels">
        <DialogHeader>
          <DialogTitle>All Partner Levels</DialogTitle>
          <DialogDescription>
            Stay active in the community and events to move up.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {isLoading && (
            <>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </>
          )}
          {levels?.map((level) => (
            <div
              key={level.key}
              className="flex items-center justify-between gap-3 rounded-md border p-2.5"
              data-testid={`row-level-${level.key}`}
            >
              <div className="flex items-center gap-2">
                {level.key === currentTierKey && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" data-testid="dot-current-level" />
                )}
                {level.key === "newcomer" ? (
                  <span className="text-sm font-medium">{level.label}</span>
                ) : (
                  <TierBadge tierKey={level.key} tierLabel={level.label} />
                )}
              </div>
              <span className="text-xs text-muted-foreground" data-testid={`text-level-threshold-${level.key}`}>
                {level.minPoints === 0 ? "Starting level" : `${level.minPoints}+ pts`}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
