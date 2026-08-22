import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { titleAndSurnameOf } from "@/lib/utils";
import type { CaseDiscussion } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList, ShoppingCart, MessageSquare, ArrowRight,
  CalendarClock, Users, CheckCircle2, CalendarPlus, Video, Lock, Loader2, GraduationCap,
} from "lucide-react";

const API_BASE = "__PORT_5001__".startsWith("__") ? "" : "__PORT_5001__";

type UpcomingCaseDiscussion = CaseDiscussion & { rsvpCount: number; iAmAttending: boolean };

interface HomeSummary {
  openReferrals: number;
  openOrders: number;
  totalReferrals: number;
  totalOrders: number;
  recentMessages: { id: number; body: string; senderName: string; createdAt: number }[];
}

function formatSessionTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CaseDiscussionsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: discussions, isLoading } = useQuery<UpcomingCaseDiscussion[]>({
    queryKey: ["/api/case-discussions"],
  });

  const rsvpMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/case-discussions/${id}/rsvp`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/case-discussions"] });
      toast({ title: "You're attending", description: "You'll get a Zoom reminder when it starts." });
    },
    onError: () => toast({ title: "Could not RSVP", description: "Please try again.", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/case-discussions/${id}/rsvp`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/case-discussions"] });
      toast({ title: "RSVP cancelled" });
    },
    onError: () => toast({ title: "Could not cancel", description: "Please try again.", variant: "destructive" }),
  });

  // The .ics endpoint requires the session cookie, so a plain <a href> can't
  // reach it cleanly. Fetch with the cookie included, then trigger a blob
  // download.
  async function downloadIcal(id: number) {
    try {
      const res = await fetch(`${API_BASE}/api/case-discussions/${id}/ical`, { credentials: "include" });
      if (!res.ok) throw new Error("download_failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `case-discussion-${id}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      toast({ title: "Could not download invite", description: "Please try again.", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Next case discussion</h2>
        <Skeleton className="h-40 rounded-lg skeleton-shimmer" />
      </div>
    );
  }

  // Keep the home page clean: render nothing when there are no upcoming sessions.
  if (!discussions || discussions.length === 0) return null;

  const upcoming = discussions.slice(0, 3);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Next case discussion</h2>
      <div className="flex flex-col gap-3">
        {upcoming.map((d) => {
          const attending = d.iAmAttending;
          const busy = rsvpMutation.isPending || cancelMutation.isPending;
          return (
            <Card key={d.id} data-testid={`card-case-discussion-${d.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <CalendarClock className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold leading-snug">{d.topic}</p>
                    <p className="text-sm text-muted-foreground mt-0.5 tabular-nums" data-testid={`text-session-time-${d.id}`}>
                      {formatSessionTime(d.scheduledAt)}
                    </p>
                    {d.presenterName && (
                      <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-presenter-${d.id}`}>
                        Case presented by {d.presenterName}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5" data-testid={`text-attendee-count-${d.id}`}>
                      <Users className="h-3.5 w-3.5" />
                      {d.rsvpCount} {d.rsvpCount === 1 ? "partner" : "partners"} attending
                    </div>
                  </div>
                </div>

                {d.notes && <p className="text-sm text-muted-foreground">{d.notes}</p>}

                {attending ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" /> You're attending
                    </div>
                    <a
                      href={d.zoomLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary break-all"
                      data-testid={`link-zoom-${d.id}`}
                    >
                      <Video className="h-4 w-4 shrink-0" /> Join Zoom
                    </a>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`hint-locked-zoom-${d.id}`}>
                    <Lock className="h-3.5 w-3.5" /> RSVP to see the Zoom link
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {attending ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelMutation.mutate(d.id)}
                      disabled={busy}
                      data-testid={`button-cancel-rsvp-${d.id}`}
                    >
                      {cancelMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => rsvpMutation.mutate(d.id)}
                      disabled={busy}
                      data-testid={`button-rsvp-${d.id}`}
                    >
                      {rsvpMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} I will attend
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadIcal(d.id)}
                    data-testid={`button-download-ical-${d.id}`}
                  >
                    <CalendarPlus className="h-3.5 w-3.5 mr-1.5" /> Add to calendar
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function PartnerHome() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<HomeSummary>({ queryKey: ["/api/partner/home-summary"] });

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-welcome">Welcome back, {titleAndSurnameOf(user?.name)}</h1>
        <p className="text-sm text-muted-foreground mt-1">Here is your personal MAHA partner dashboard. Let us know how we can help.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
          </>
        ) : (
          <>
            <Link href="/refer" data-testid="card-open-referrals">
              <Card className="hover-elevate active-elevate-2 cursor-pointer">
                <CardContent className="p-4 flex flex-col gap-1">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  <span className="text-2xl font-semibold tabular-nums" data-testid="text-open-referrals-count">{data?.openReferrals ?? 0}</span>
                  <span className="text-xs text-muted-foreground">Open referrals</span>
                </CardContent>
              </Card>
            </Link>
            <Link href="/shop?tab=orders" data-testid="card-open-orders">
              <Card className="hover-elevate active-elevate-2 cursor-pointer">
                <CardContent className="p-4 flex flex-col gap-1">
                  <ShoppingCart className="h-5 w-5 text-accent" />
                  <span className="text-2xl font-semibold tabular-nums" data-testid="text-open-orders-count">{data?.openOrders ?? 0}</span>
                  <span className="text-xs text-muted-foreground">Open order requests</span>
                </CardContent>
              </Card>
            </Link>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Quick links</h2>
        <Link href="/refer" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-refer">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">Refer a patient</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/shop" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-shop">
          <div className="flex items-center gap-3">
            <ShoppingCart className="h-5 w-5 text-accent" />
            <span className="text-sm font-medium">Order from B2B shop</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/chat" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-chat">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-chart-4" />
            <span className="text-sm font-medium">Chat with MAHA team</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/videos" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-learn">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-5 w-5 text-chart-2" />
            <span className="text-sm font-medium">Learn</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      <CaseDiscussionsSection />

      {!isLoading && data && data.recentMessages.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Latest chat activity</h2>
          <Card>
            <CardContent className="p-4 flex flex-col gap-3">
              {data.recentMessages.map((m) => (
                <div key={m.id} className="text-sm" data-testid={`text-recent-message-${m.id}`}>
                  <span className="font-medium">{m.senderName}: </span>
                  <span className="text-muted-foreground">{m.body}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
