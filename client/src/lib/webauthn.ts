// Thin wrappers around @simplewebauthn/browser tying the ceremony to this
// app's API endpoints. Kept separate from AuthContext so both the login page
// and the account settings page can reuse the same logic.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { apiRequest } from "@/lib/queryClient";
import type { AuthUser } from "@/context/AuthContext";

export { browserSupportsWebAuthn };

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
