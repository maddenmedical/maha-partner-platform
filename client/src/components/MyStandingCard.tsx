import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TierBadge } from "@/components/TierBadge";
import { StandingLevelsDialog } from "@/components/StandingLevelsDialog";

type MyStanding = { tierKey: string; tierLabel: string; hasNextTier: boolean; progressPercent: number };

// Own MAHA Standing tier + soft progress, shared between Account and Home so
// partners/students see it in both places. Never shows raw points or how
// they're earned -- see shared/schema.ts note on STANDING_TIERS.
export function MyStandingCard({ className }: { className?: string }) {
  const { data: myStanding } = useQuery<MyStanding>({
    queryKey: ["/api/standing/mine"],
  });

  if (!myStanding) return null;

  return (
    <Card className={className} data-testid="card-my-standing">
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">MAHA Standing</h2>
          {myStanding.tierKey === "newcomer" ? (
            <span className="text-xs text-muted-foreground" data-testid="text-standing-newcomer">{myStanding.tierLabel}</span>
          ) : (
            <TierBadge tierKey={myStanding.tierKey} tierLabel={myStanding.tierLabel} />
          )}
        </div>
        {myStanding.hasNextTier ? (
          <div className="flex flex-col gap-1.5">
            <Progress value={myStanding.progressPercent} className="h-2" data-testid="progress-standing" />
            <p className="text-xs text-muted-foreground">
              Stay active in the community and events to reach the next level.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            You've reached the highest level. Thank you for being such an active part of MAHA.
          </p>
        )}
        <div>
          <StandingLevelsDialog currentTierKey={myStanding.tierKey} />
        </div>
      </CardContent>
    </Card>
  );
}
