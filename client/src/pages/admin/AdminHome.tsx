import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { getGreetingName } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserCheck, Inbox, ShoppingCart, MessageSquare, Users2, GraduationCap,
} from "lucide-react";

interface DashboardSummary {
  pendingApprovals: number;
  newReferrals: number;
  requestedOrders: number;
  unreadChatThreads: number;
  communityUnread: number;
  newEnrollments: number;
}

// One tile in the "what's new since you last opened this" grid. `count`
// drives both the number shown and whether the tile gets the amber
// needs-attention treatment -- a plain gray/zero tile fades into the
// background so the admin's eye goes straight to what actually changed.
function SummaryTile({
  href, icon: Icon, count, label, colorClass, testId,
}: {
  href: string;
  icon: typeof UserCheck;
  count: number;
  label: string;
  colorClass: string;
  testId: string;
}) {
  const hasNew = count > 0;
  return (
    <Link href={href} data-testid={testId}>
      <Card className={hasNew ? "hover-elevate active-elevate-2 cursor-pointer bg-chart-4/5 border-chart-4/30" : "hover-elevate active-elevate-2 cursor-pointer"}>
        <CardContent className="p-4 flex flex-col gap-1">
          <Icon className={`h-5 w-5 ${colorClass}`} />
          <span className="text-2xl font-semibold tabular-nums" data-testid={`${testId}-count`}>{count}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function AdminHome() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/admin/dashboard-summary"],
    refetchInterval: 15000,
  });

  // Marking enrollments seen only after the summary has actually loaded and
  // rendered -- the count above already reflects the pre-mark snapshot the
  // GET returned, so this can't make the number flicker to 0 in front of
  // the admin. It just means the *next* visit only counts what's new since
  // now. Referrals/orders/chat/community don't need this: they already
  // clear themselves the normal way (status change, opening the thread).
  const markEnrollmentsSeenMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/course-purchases/mark-seen"),
  });
  useEffect(() => {
    if (data && data.newEnrollments > 0) {
      markEnrollmentsSeenMutation.mutate(undefined, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/videos"] }),
      });
    }
    // Only fire once per successful summary load, not on every refetch tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-admin-welcome">
          Welcome back, {getGreetingName(user ?? {})}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here's what's new since you last checked in.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
          </>
        ) : (
          <>
            <SummaryTile
              href="/admin/approvals"
              icon={UserCheck}
              count={data?.pendingApprovals ?? 0}
              label="Pending approvals"
              colorClass="text-primary"
              testId="card-summary-approvals"
            />
            <SummaryTile
              href="/admin/referrals"
              icon={Inbox}
              count={data?.newReferrals ?? 0}
              label="New referrals"
              colorClass="text-chart-2"
              testId="card-summary-referrals"
            />
            <SummaryTile
              href="/admin/orders"
              icon={ShoppingCart}
              count={data?.requestedOrders ?? 0}
              label="New orders"
              colorClass="text-accent"
              testId="card-summary-orders"
            />
            <SummaryTile
              href="/admin/chat"
              icon={MessageSquare}
              count={data?.unreadChatThreads ?? 0}
              label="Unread chats"
              colorClass="text-chart-4"
              testId="card-summary-chat"
            />
            <SummaryTile
              href="/admin/community"
              icon={Users2}
              count={data?.communityUnread ?? 0}
              label="Unread community"
              colorClass="text-chart-3"
              testId="card-summary-community"
            />
            <SummaryTile
              href="/admin/videos"
              icon={GraduationCap}
              count={data?.newEnrollments ?? 0}
              label="New enrollments"
              colorClass="text-chart-2"
              testId="card-summary-enrollments"
            />
          </>
        )}
      </div>
    </div>
  );
}
