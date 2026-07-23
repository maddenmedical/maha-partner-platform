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
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    sharedDeferredPrompt = null;
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

  const canInstallNative = !!sharedDeferredPrompt && !isStandalone();
  const isIosInstallable = isIos() && !isStandalone();
  // Something actionable to offer the user at all.
  const isInstallable = canInstallNative || isIosInstallable;

  const promptInstall = useCallback(async () => {
    if (!sharedDeferredPrompt) return false;
    await sharedDeferredPrompt.prompt();
    const choice = await sharedDeferredPrompt.userChoice;
    sharedDeferredPrompt = null;
    listeners.forEach((l) => l());
    return choice.outcome === "accepted";
  }, []);

  return { canInstallNative, isIosInstallable, isInstallable, promptInstall };
}
