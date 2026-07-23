import { useEffect, useState, useCallback } from "react";
import { Bell, X, Share, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isPushSupported, subscribeToPush } from "@/lib/push";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";

// One-time dismissal is also tracked in memory (module scope) as a fallback so
// the banner never reappears mid-session even before the backend call resolves.
let dismissedThisSession = false;

export function PushPrompt() {
  const { toast } = useToast();
  const { user, markInstallBannerDismissed } = useAuth();
  const { canInstallNative, isIosInstallable, promptInstall } = useInstallPrompt();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"install" | "ios" | "push">("push");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dismissedThisSession || user?.installBannerDismissedAt) return;
    if (canInstallNative) {
      setMode("install");
      setVisible(true);
      return;
    }
    if (isIosInstallable) {
      setMode("ios");
      setVisible(true);
      return;
    }
    if (!isPushSupported()) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    setMode("push");
    setVisible(true);
  }, [canInstallNative, isIosInstallable, user?.installBannerDismissedAt]);

  const dismiss = useCallback(() => {
    dismissedThisSession = true;
    setVisible(false);
    markInstallBannerDismissed();
    void apiRequest("POST", "/api/auth/dismiss-install-banner").catch(() => {
      // Non-critical — banner still stays hidden for this session.
    });
  }, [markInstallBannerDismissed]);

  async function handleInstall() {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
      dismiss();
    }
  }

  async function handleEnablePush() {
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
        {mode === "install" ? (
          <Download className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        ) : (
          <Bell className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        )}
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div>
            {mode === "install" && (
              <>
                <p className="text-sm font-medium">Install the MAHA app</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Get quick access from your home screen and stay up to date with notifications.
                </p>
              </>
            )}
            {mode === "ios" && (
              <>
                <p className="text-sm font-medium">Add MAHA to your Home Screen</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                  Tap <Share className="h-3 w-3 inline" /> Share, then “Add to Home Screen” for
                  quick access and to enable notifications.
                </p>
              </>
            )}
            {mode === "push" && (
              <>
                <p className="text-sm font-medium">Get notified about new discounts and lectures</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Turn on push notifications to stay up to date.
                </p>
              </>
            )}
          </div>
          {mode === "install" && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleInstall} disabled={busy} data-testid="button-install-app">
                {busy ? "Installing…" : "Install"}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss} data-testid="button-dismiss-install">
                Not now
              </Button>
            </div>
          )}
          {mode === "push" && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleEnablePush} disabled={busy} data-testid="button-enable-push">
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
