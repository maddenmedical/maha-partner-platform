import { apiRequest } from "./queryClient";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// iOS Safari only permits web push once the app is installed to the Home Screen
// (running in standalone display mode). Detect that combination so the UI can
// show the Add-to-Home-Screen instructions instead of an Enable button.
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch points.
  const iPadOS = navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

export function iosNeedsInstall(): boolean {
  return isIos() && !isStandalone();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// Requests notification permission, subscribes to push via the registered
// service worker, and posts the subscription to the backend. Throws on failure
// so callers can surface the reason to the user.
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error("Push is not supported in this browser.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const registration = await navigator.serviceWorker.ready;

  const keyRes = await apiRequest("GET", "/api/push/vapid-public-key");
  const { publicKey } = await keyRes.json();
  if (!publicKey) throw new Error("Push is not configured on the server.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await apiRequest("POST", "/api/push/subscribe", subscription.toJSON());
}
