import { useState } from "react";
import { Download, Share, SquarePlus, Chrome } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { isIos } from "@/lib/push";

// A persistent, always-visible install affordance (as opposed to the one-time
// dismissible PushPrompt banner). Most people don't know what "Add to Home
// Screen" means, but everyone understands "Install" — so this always reads
// "Install app" and, on iOS where there's no native install API, walks
// through the Share -> Add to Home Screen steps with icons instead of text
// alone. Renders nothing once the app is already installed or the current
// browser offers no install path at all.
export function InstallAppButton({ variant = "icon" }: { variant?: "icon" | "full" }) {
  const { canInstallNative, isIosInstallable, isInstallable, promptInstall } = useInstallPrompt();
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!isInstallable) return null;

  async function handleClick() {
    if (canInstallNative) {
      setInstalling(true);
      try {
        await promptInstall();
      } finally {
        setInstalling(false);
      }
      return;
    }
    if (isIosInstallable) {
      setShowIosGuide(true);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          onClick={handleClick}
          disabled={installing}
          aria-label="Install app"
          className="h-9 w-9 flex items-center justify-center rounded-md hover-elevate active-elevate-2 text-muted-foreground"
          data-testid="button-install-app-header"
        >
          <Download className="h-4 w-4" />
        </button>
      ) : (
        <Button variant="outline" size="sm" onClick={handleClick} disabled={installing} data-testid="button-install-app-header">
          <Download className="h-3.5 w-3.5 mr-1.5" />
          {installing ? "Installing…" : "Install app"}
        </Button>
      )}

      <Dialog open={showIosGuide} onOpenChange={setShowIosGuide}>
        <DialogContent data-testid="dialog-ios-install-guide" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Install MAHA as an app</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Adds a MAHA icon to your home screen — opens full-screen, just like an app from the App Store.
          </p>
          <div className="flex flex-col gap-4 mt-2">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-primary">1</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span>Tap the</span>
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-muted shrink-0">
                  <Share className="h-3.5 w-3.5" />
                </span>
                <span>Share button {isIos() ? "in Safari's toolbar" : "in your browser"}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-primary">2</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span>Scroll down and tap</span>
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-muted shrink-0">
                  <SquarePlus className="h-3.5 w-3.5" />
                </span>
                <span>"Add to Home Screen"</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-primary">3</span>
              </div>
              <p className="text-sm">Tap <span className="font-medium">Add</span> in the top right — done.</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Chrome className="h-3 w-3 shrink-0" />
            Using Chrome on iPhone? Open this page in Safari first — only Safari can install to your home screen.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
