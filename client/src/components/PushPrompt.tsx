import { useEffect, useState } from "react";
import { Bell, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isPushSupported, subscribeToPush, iosNeedsInstall } from "@/lib/push";

// One-time dismissal is tracked in memory (module scope) because the sandboxed
// preview iframe blocks web storage. This keeps the banner from reappearing on
// every route change within a session without depending on localStorage.
let dismissedThisSession = false;

export function PushPrompt() {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [iosMode, setIosMode] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dismissedThisSession) return;
    if (iosNeedsInstall()) {
      setIosMode(true);
      setVisible(true);
      return;
    }
    if (!isPushSupported()) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    setVisible(true);
  }, []);

  function dismiss() {
    dismissedThisSession = true;
    setVisible(false);
  }

  async function handleEnable() {
    setBusy(true);
    try {
      await subscribeToPush();
      toast({ title: "Notifications enabled", description: "You'll hear about new discounts and lectures." });
      dismiss();
    } catch (err: any) {
      toast({ title: "Could not enable notifications", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed top-3 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-md rounded-lg border border-card-border bg-card shadow-lg p-4 flex items-start gap-3"
        data-testid="banner-push-prompt"
      >
        <Bell className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div>
            <p className="text-sm font-medium">Get notified about new discounts and lectures</p>
            {iosMode ? (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                On iPhone/iPad, tap <Share className="h-3 w-3 inline" /> Share, then
                “Add to Home Screen” and open MAHA from there to enable notifications.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Turn on push notifications to stay up to date.
              </p>
            )}
          </div>
          {!iosMode && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleEnable} disabled={busy} data-testid="button-enable-push">
                {busy ? "Enabling…" : "Enable"}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss} data-testid="button-dismiss-push">
                Not now
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-muted-foreground hover-elevate active-elevate-2 rounded-md p-1"
          data-testid="button-close-push-prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
