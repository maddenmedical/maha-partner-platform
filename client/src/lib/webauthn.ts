// Thin wrappers around @simplewebauthn/browser tying the ceremony to this
// app's API endpoints. Kept separate from AuthContext so both the login page
// and the account settings page can reuse the same logic.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { apiRequest } from "@/lib/queryClient";
import type { AuthUser } from "@/context/AuthContext";

export { browserSupportsWebAuthn };

// WebAuthn never reports which biometric modality was actually used to
// unlock the platform authenticator (Face ID vs. Touch ID vs. fingerprint
// vs. a PIN) -- that detail is intentionally kept private by the OS. The
// best we can honestly say is what this device is capable of, based on its
// user agent, instead of claiming a specific method that may not exist on
// this device (e.g. showing "Face ID" on a device that only has a
// fingerprint sensor).
export function platformAuthLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "Face ID or Touch ID";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Touch ID";
  if (/Android/i.test(ua)) return "your fingerprint or face unlock";
  if (/Windows/i.test(ua)) return "Windows Hello";
  return "your device's screen lock (Face ID, Touch ID, fingerprint, or PIN)";
}

// Short label safe to inline into a single-line, non-wrapping button --
// platformAuthLabel() above can run to 60+ characters on some devices
// (notably the generic fallback), which was blowing buttons -- and with
// them the whole flex layout around them -- wider than the viewport on
// narrow phones. "Passkey" is universally understood and never long.
export function platformAuthLabelShort(): string {
  return "passkey";
}

// Registers a new passkey for the CURRENTLY authenticated user (requires an
// existing session — used from account settings, never from the login
// page).
export async function registerPasskey(): Promise<void> {
  const optionsRes = await apiRequest("POST", "/api/webauthn/register/options");
  const optionsJSON = await optionsRes.json();
  const response = await startRegistration({ optionsJSON });
  await apiRequest("POST", "/api/webauthn/register/verify", { response });
}

// Signs the user in via a previously-registered passkey. No auth required —
// this IS the login. The server sets the session cookie on this response, so
// we only need to return the user.
export async function loginWithPasskey(): Promise<{ user: AuthUser }> {
  const optionsRes = await apiRequest("GET", "/api/webauthn/login/options");
  const optionsJSON = await optionsRes.json();
  const response = await startAuthentication({ optionsJSON });
  const verifyRes = await apiRequest("POST", "/api/webauthn/login/verify", { response });
  return verifyRes.json();
}

export interface WebauthnCredentialSummary {
  id: number;
  label: string;
  deviceType: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export async function listPasskeys(): Promise<WebauthnCredentialSummary[]> {
  const res = await apiRequest("GET", "/api/webauthn/credentials");
  return res.json();
}

export async function deletePasskey(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/webauthn/credentials/${id}`);
}
