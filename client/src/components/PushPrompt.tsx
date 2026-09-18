import { useEffect, useState, useCallback } from "react";
import { Bell, X, Share, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isPushSupported, subscribeToPush } from "@/lib/push";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { apiRequest } from "@/lib/queryClient";
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { navigate } from "wouter/use-hash-location";

// One-time dismissal is also tracked in memory (module scope) as a fallback so
// the banner never reappears mid-session even before the backend call resolves.
let dismissedThisSession = false;

// How long to wait before re-asking someone whose notification setup is
// still "weak" -- push never enabled on this device, or any category dialed
// below "preview". ~3 months.
const RECHECK_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

const STYLE_FIELDS: { enabled: keyof AuthUser; style: keyof AuthUser }[] = [
  { enabled: "notifyCommunityEnabled", style: "notifyCommunityStyle" },
  { enabled: "notifyChatEnabled", style: "notifyChatStyle" },
  { enabled: "notifyOrdersEnabled", style: "notifyOrdersStyle" },
  { enabled: "notifyOffersEnabled", style: "notifyOffersStyle" },
  { enabled: "notifyStaffEnabled", style: "notifyStaffStyle" },
];

// "Weak" = push isn't actually enabled on this device at all (permission
// never granted -- whether still undecided or explicitly denied), or the
// person has dialed at least one category below "preview" (Alert only /
// Silent). Either way, previews aren't reliably reaching them -- worth a
// periodic nudge back toward full previews, since "no one will go looking
// for this setting on their own".
function isDeviceWeak(): boolean {
  return !isPushSupported() || Notification.permission !== "granted";
}

function hasStyleWeakCategory(user: AuthUser): boolean {
  return STYLE_FIELDS.some(
    ({ enabled, style }) => user[enabled] && user[style] !== "preview"
  );
}

export function PushPrompt() {
  const { toast } = useToast();
  const { user, markInstallBannerDismissed, markPushNudgePrompted } = useAuth();
  const { canInstallNative, isIosInstallable, promptInstall } = useInstallPrompt();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"install" | "ios" | "push" | "recheck">("push");
  const [recheckReason, setRecheckReason] = useState<"device" | "style">("style");
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
    if (!user) return;

    // First-ever ask: we've never shown this prompt before on this account.
    const isFirstAsk = user.pushNudgeLastPromptedAt == null;
    const dueForRecheck =
      user.pushNudgeLastPromptedAt != null &&
      Date.now() - user.pushNudgeLastPromptedAt > RECHECK_INTERVAL_MS;

    if (!isFirstAsk && !dueForRecheck) return;

    const deviceWeak = isDeviceWeak();
    const styleWeak = hasStyleWeakCategory(user);
    if (!deviceWeak && !styleWeak) return;

    // Only offer the direct native "Enable" flow when the browser permission
    // is genuinely still undecided ("default") -- calling
    // Notification.requestPermission() again after the user already denied
    // it does nothing but silently fail, producing a dead-end "Could not
    // enable" toast. In every other weak case (already denied, or a
    // returning user whose categories are just dialed down) we point them
    // at their settings instead via the tailored recheck copy.
    const canRequestNow = isPushSupported() && Notification.permission === "default";
    if (isFirstAsk && canRequestNow) {
      setMode("push");
    } else {
      setRecheckReason(deviceWeak ? "device" : "style");
      setMode("recheck");
    }
    setVisible(true);
    markPushNudgePrompted();
  }, [canInstallNative, isIosInstallable, user, markPushNudgePrompted]);

  const dismiss = useCallback(() => {
    dismissedThisSession = true;
    setVisible(false);
    markInstallBannerDismissed();
    void apiRequest("POST", "/api/auth/dismiss-install-banner").catch(() => {
      // Non-critical — banner still stays hidden for this session.
    });
  }, [markInstallBannerDismissed]);

  // Recheck banner dismissal shouldn't touch installBannerDismissedAt (that
  // permanently hides the install/push-permission prompts) -- it just hides
  // this banner for the current session; markPushNudgePrompted() above
  // already recorded the ask so it won't reappear until the next window.
  const dismissRecheck = useCallback(() => {
    dismissedThisSession = true;
    setVisible(false);
  }, []);

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
            {mode === "recheck" && (
              <>
                <p className="text-sm font-medium">
                  {recheckReason === "device"
                    ? "Still not getting notifications on this device?"
                    : "You've muted some notification previews"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {recheckReason === "device"
                    ? "Push notifications aren't enabled here, so you could be missing updates. You can turn them on any time in your notification settings."
                    : "Some categories are set to Alert or Silent, so you may be missing details. Want to turn previews back on?"}
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
          {mode === "recheck" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  dismissRecheck();
                  navigate("/account");
                }}
                data-testid="button-review-notification-settings"
              >
                Review settings
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissRecheck} data-testid="button-dismiss-recheck">
                Not now
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={mode === "recheck" ? dismissRecheck : dismiss}
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
