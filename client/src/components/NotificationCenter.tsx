import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, AlertTriangle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Notice = { id: string; title: string; body: string; url: string; critical: boolean; createdAt: number };
type Summary = { count: number; criticalCount: number; firstCritical?: Notice; items: Notice[] };
type BadgeNavigator = Navigator & { setAppBadge?: (count: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
function useNotifications() {
  const { user } = useAuth();
  return useQuery<Summary>({ queryKey: ["/api/notifications", user?.id],
    queryFn: async () => (await apiRequest("GET", "/api/notifications")).json(),
    enabled: !!user && !user.impersonating, refetchInterval: 15000, refetchOnWindowFocus: true });
}
function destination(url: string) {
  const target = new URL(url, window.location.href);
  return target.hash.startsWith("#/") ? target.hash.slice(1) + target.search : "/";
}
export function NotificationBell() {
  const { data, isLoading, isError, refetch } = useNotifications();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  useEffect(() => {
    if (!data || user?.impersonating) return;
    const nav = navigator as BadgeNavigator;
    void nav.setAppBadge?.(data.count).catch(() => {});
  }, [data?.count, user?.impersonating]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "MAHA_NOTIFICATIONS_CHANGED") {
        void queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [queryClient]);
  async function review(item: Notice) {
    try {
      // Referrals stay highlighted until their actual detail opens.
      if (!item.critical) await apiRequest("POST", "/api/notifications/read", { ids: [item.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setOpen(false); navigate(destination(item.url));
    } catch { toast({ title: "Could not open notification. Please try again.", variant: "destructive" }); }
  }
  return <>
    <Button variant="ghost" size="icon" className="relative shrink-0" onClick={() => setOpen(true)}
      aria-label={`Notifications, ${data?.count || 0} unread`} data-testid="button-notifications">
      <Bell className="h-5 w-5" />
      {!!data?.count && <span className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-destructive text-destructive-foreground px-1 text-xs leading-5 font-semibold"
        data-testid="notification-count">{data.count > 99 ? "99+" : data.count}</span>}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[80dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Notifications</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Alerts stay unread until you review them. Referrals require individual review.</p>
        {isLoading && <p className="py-4 text-sm">Loading notifications…</p>}
        {isError && <div className="text-sm text-destructive">Notifications could not be refreshed.
          <Button variant="outline" className="ml-2" onClick={() => void refetch()}>Retry</Button></div>}
        {data && !data.count && !isError && <p className="py-4 text-sm">You're up to date.</p>}
        {data?.items.map(item => <button key={item.id} onClick={() => review(item)}
          className={`w-full rounded-lg border p-3 text-left ${item.critical ? "border-destructive/60 bg-destructive/10" : "border-border hover:bg-muted"}`}
          data-testid={`notification-${item.id}`}>
          <span className="block text-sm font-semibold">{item.critical && <AlertTriangle className="inline mr-2 h-4 w-4" />}{item.title}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{item.body}</span>
          <span className="mt-2 block text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
        </button>)}
        {data && data.count > data.criticalCount && <Button variant="outline" onClick={async () => {
          try { await apiRequest("POST", "/api/notifications/read", {});
            await queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }); }
          catch { toast({ title: "Could not update notifications", variant: "destructive" }); }
        }}>Mark non-referral alerts as read</Button>}
      </DialogContent>
    </Dialog>
  </>;
}
export function CriticalReferralBanner() {
  const { data } = useNotifications();
  const [, navigate] = useLocation();
  if (!data?.criticalCount || !data.firstCritical) return null;
  return <div role="alert" className="mx-4 mt-3 rounded-lg border-2 border-destructive/70 bg-destructive/10 p-3 flex flex-wrap items-center gap-3 shrink-0"
    data-testid="critical-referral-alert">
    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
    <div className="flex-1 min-w-40">
      <p className="text-sm font-semibold">{data.criticalCount} {data.criticalCount === 1 ? "referral needs" : "referrals need"} your review</p>
      <p className="text-xs text-muted-foreground">This alert stays visible until you open the referral.</p>
    </div>
    <Button variant="destructive" size="sm" onClick={() => navigate(destination(data.firstCritical!.url))}
      data-testid="button-review-referral-alert">Review referral</Button>
  </div>;
}
