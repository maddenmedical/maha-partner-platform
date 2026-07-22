import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  New: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  Contacted: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  Scheduled: "bg-primary/15 text-primary border-primary/30",
  Closed: "bg-muted text-muted-foreground border-transparent",
  Requested: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  Confirmed: "bg-primary/15 text-primary border-primary/30",
  Fulfilled: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  Cancelled: "bg-destructive/15 text-destructive border-destructive/30",
  pending: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  approved: "bg-primary/15 text-primary border-primary/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  Normal: "bg-muted text-muted-foreground border-transparent",
  Urgent: "bg-destructive/15 text-destructive border-destructive/30",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("no-default-hover-elevate no-default-active-elevate", STATUS_STYLES[status] || "")} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}
