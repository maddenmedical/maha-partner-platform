import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, AlertTriangle } from "lucide-react";
import { MahaLogo } from "@/components/MahaLogo";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Notice = { id: string; title: string; body: string; url: string; critical: boolean; createdAt: number };
type Summary = { count: number; criticalCount: number; firstCritical?: Notice; items: Notice[] };
type BadgeNavigator = Navigator & { setAppBadge?: (count: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
const OPEN_NOTIFICATIONS = "MAHA_OPEN_NOTIFICATIONS";
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
  const enhanced = user?.notifyEnhancedVisibility !== false;
  useEffect(() => {
    if (!data || user?.impersonating) return;
    const nav = navigator as BadgeNavigator;
    void nav.setAppBadge?.(data.count).catch(() => {});
  }, [data?.count, user?.impersonating]);
  useEffect(() => {
    const originalTitle = document.title;
    if (user && !user.impersonating && enhanced && data?.count) {
      document.title = `(${data.count}) MAHA Partner Platform`;
    }
    return () => { document.title = originalTitle; };
  }, [data?.count, user?.id, user?.impersonating, enhanced]);
  useEffect(() => {
    const showInbox = () => setOpen(true);
    window.addEventListener(OPEN_NOTIFICATIONS, showInbox);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS, showInbox);
  }, []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "MAHA_NOTIFICATIONS_CHANGED") {
        void queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      }
    };
    // Some embedded/restricted browsers expose the property but throw when it
    // is read. The persistent inbox must keep working through polling there.
    let worker: ServiceWorkerContainer | undefined;
    try {
      worker = navigator.serviceWorker;
      worker?.addEventListener("message", onMessage);
    } catch {}
    return () => worker?.removeEventListener("message", onMessage);
  }, [queryClient]);
  async function review(item: Notice) {
    try {
      // Referrals stay highlighted until their actual detail opens.
      if (!item.critical) await apiRequest("POST", "/api/notifications/read", { ids: [item.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setOpen(false); navigate(destination(item.url));
    } catch { toast({ title: "Could not open notification. Please try again.", variant: "destructive" }); }
  }
  if (user?.impersonating) return null;
  return <>
    <Button variant="ghost" size="icon"
      className={`relative shrink-0 ${enhanced ? "h-11 w-11" : ""} ${enhanced && data?.count ? "bg-red-50 text-red-700 ring-1 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-700" : ""}`}
      onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog"
      aria-label={`Notifications, ${data?.count || 0} unread`} data-testid="button-notifications">
      <Bell className={enhanced ? "h-6 w-6" : "h-5 w-5"} />
      {!!data?.count && <span className={`absolute -top-1 -right-1 rounded-full bg-red-700 text-white ring-2 ring-background px-1 text-xs font-bold ${enhanced ? "min-w-6 h-6 leading-6" : "min-w-5 h-5 leading-5"}`}
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
export function NotificationAttentionBanner() {
  const { data } = useNotifications();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  if (user?.impersonating || !data?.count) return null;
  if (user?.notifyEnhancedVisibility === false) {
    if (!data.criticalCount || !data.firstCritical) return null;
    return <div role="alert" className="mx-4 my-2 rounded-lg border-2 border-destructive/70 bg-destructive/10 p-3 flex flex-wrap items-center gap-3 shrink-0"
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
  return <section aria-label="Unread MAHA activity"
    className="mx-4 my-2 rounded-lg border-2 border-red-600 bg-red-50 p-3 text-red-950 dark:bg-red-950/40 dark:text-red-100 flex flex-wrap items-center gap-3 shrink-0"
    data-testid="notification-attention-banner">
    <div className="relative shrink-0 rounded-lg bg-background p-2 text-primary" aria-hidden="true">
      <MahaLogo size={28} />
      <span className="absolute -top-2 -right-2 min-w-6 h-6 rounded-full bg-red-700 text-white ring-2 ring-background px-1 text-xs leading-6 text-center font-bold"
        data-testid="app-unread-count">{data.count > 99 ? "99+" : data.count}</span>
    </div>
    <div className="flex-1 min-w-[9rem]" role="status" aria-live="polite" aria-atomic="true">
      <p className="text-sm font-bold">{data.count} unread {data.count === 1 ? "notification" : "notifications"}</p>
      {data.criticalCount > 0 ? <p className="text-xs font-semibold" data-testid="critical-referral-alert">
        <AlertTriangle className="inline mr-1 h-4 w-4" />
        {data.criticalCount} {data.criticalCount === 1 ? "referral needs" : "referrals need"} your review.
      </p> : <p className="text-xs">Stays here until you review or mark alerts as read.</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      {!!data.criticalCount && data.firstCritical && <Button size="sm"
        className="bg-red-700 text-white hover:bg-red-800 min-h-10"
        onClick={() => navigate(destination(data.firstCritical!.url))}
        data-testid="button-review-referral-alert">Review referral</Button>}
      <Button variant="outline" size="sm" className="border-red-400 min-h-10"
        onClick={() => window.dispatchEvent(new Event(OPEN_NOTIFICATIONS))}
        data-testid="button-view-unread">View all</Button>
    </div>
  </section>;
}
