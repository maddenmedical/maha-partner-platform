import { useEffect, useState, useCallback } from "react";
import { isIos, isStandalone } from "@/lib/push";

// Minimal shape for the non-standard beforeinstallprompt event (Chrome/Android/desktop).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Shared install-prompt state so multiple UI entry points (header button,
// PushPrompt banner) all react to the same captured beforeinstallprompt event
// without each registering their own listener.
let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let sharedInstalled = false;
let sharedInstalling = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    sharedDeferredPrompt = null;
    sharedInstalled = true;
    listeners.forEach((l) => l());
  });
}

export function useInstallPrompt() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const notify = () => setTick((t) => t + 1);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  const isInstalled = sharedInstalled || isStandalone();
  const canInstallNative = !!sharedDeferredPrompt && !isInstalled;
  const isIosInstallable = isIos() && !isInstalled;
  // Something actionable to offer the user at all.
  const isInstallable = canInstallNative || isIosInstallable;

  const promptInstall = useCallback(async () => {
    // Capture and consume this one-shot event before awaiting. appinstalled
    // can clear shared state while the browser's prompt is still resolving.
    const event = sharedDeferredPrompt;
    if (!event || sharedInstalling) return false;
    sharedDeferredPrompt = null;
    sharedInstalling = true;
    listeners.forEach((l) => l());
    try {
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome === "accepted";
    } catch {
      // Unsupported contexts or a stale prompt must not crash an entry point.
      return false;
    } finally {
      sharedInstalling = false;
      listeners.forEach((l) => l());
    }
  }, []);

  return { canInstallNative, isIosInstallable, isInstallable, isInstalled, isInstalling: sharedInstalling, promptInstall };
}
