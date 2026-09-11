// Face ID / Fingerprint (WebAuthn) login helpers.
//
// This is an ADDITION to, not a replacement for, the existing email/password
// login. A partner or student can register one or more passkeys (platform
// authenticators: Face ID, Touch ID, Windows Hello, or a fingerprint reader)
// from their account settings, then use "Sign in with Face ID / Fingerprint"
// on the login screen instead of typing a password.
//
// Design notes:
// - Login is usernameless/discoverable: we never ask for an email first.
//   The registered credential itself carries enough information (via its
//   credentialId) for us to look up which user it belongs to.
// - rpID/origin are derived from the incoming request rather than hardcoded,
//   since this app is reachable from multiple hosts over its lifetime
//   (local dev, pplx.app preview sandboxes, and the production pplx.app
//   domain). WebAuthn requires the RP ID to exactly match (or be a
//   registrable suffix of) the page's origin, so a hardcoded value would
//   break registration/login the moment the hosting domain changes.
// - Challenges are single-use and kept in an in-memory Map with a short TTL.
//   This is safe because the app runs as a single Node process (no
//   multi-instance/horizontal scaling), matching how sessions/other
//   short-lived server state is already handled elsewhere in this codebase.
import type { Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  WebAuthnCredential,
} from "@simplewebauthn/server";

export const RP_NAME = "MAHA Partner Plattform";
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
  // Present for registration challenges (tied to the already-authenticated
  // user); absent for login challenges, since we don't know who's signing in
  // until we've looked up the credential they used.
  userId?: number;
}
const pendingChallenges = new Map<string, PendingChallenge>();

function sweepExpired() {
  const now = Date.now();
  pendingChallenges.forEach((val, key) => {
    if (val.expiresAt < now) pendingChallenges.delete(key);
  });
}

function storeChallenge(challenge: string, userId?: number) {
  sweepExpired();
  pendingChallenges.set(challenge, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS, userId });
}

// Consumes (single-use) and validates a challenge. Returns the associated
// userId (or undefined for a login challenge) if valid, otherwise undefined.
function takeChallenge(challenge: string): { ok: true; userId?: number } | { ok: false } {
  const entry = pendingChallenges.get(challenge);
  pendingChallenges.delete(challenge);
  if (!entry || entry.expiresAt < Date.now()) return { ok: false };
  return { ok: true, userId: entry.userId };
}

export function getRpID(req: Request): string {
  return req.hostname;
}

export function getOrigin(req: Request): string {
  return req.headers.origin || `${req.protocol}://${req.get("host")}`;
}

function toTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export async function buildRegistrationOptions(
  req: Request,
  user: { id: number; email: string; name: string },
  existingCredentialIds: string[]
) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(req),
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(String(user.id)),
    attestationType: "none",
    excludeCredentials: existingCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });
  storeChallenge(options.challenge, user.id);
  return options;
}

export async function verifyRegistration(
  req: Request,
  userId: number,
  response: RegistrationResponseJSON
): Promise<{ verified: boolean; credential?: WebAuthnCredential; deviceType?: string; backedUp?: boolean }> {
  // The challenge is embedded (base64url-encoded) in the response's
  // clientDataJSON; decode it so we can look up — and single-use-consume —
  // the matching pending challenge before asking simplewebauthn to verify
  // the cryptographic signature.
  const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
  const taken = takeChallenge(clientData.challenge);
  if (!taken.ok || taken.userId !== userId) return { verified: false };

  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: clientData.challenge,
    expectedOrigin: getOrigin(req),
    expectedRPID: getRpID(req),
  });
  if (!result.verified || !result.registrationInfo) return { verified: false };
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  return { verified: true, credential, deviceType: credentialDeviceType, backedUp: credentialBackedUp };
}

export async function buildAuthenticationOptions(req: Request) {
  // No allowCredentials — this is a discoverable/usernameless login. Any
  // passkey the browser has for this rpID can respond.
  const options = await generateAuthenticationOptions({
    rpID: getRpID(req),
    userVerification: "preferred",
  });
  storeChallenge(options.challenge);
  return options;
}

export async function verifyAuthentication(
  req: Request,
  response: AuthenticationResponseJSON,
  storedCredential: { credentialId: string; publicKey: string; counter: number; transports: string | null }
): Promise<{ verified: boolean; newCounter?: number }> {
  const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
  const taken = takeChallenge(clientData.challenge);
  if (!taken.ok) return { verified: false };

  const credential: WebAuthnCredential = {
    id: storedCredential.credentialId,
    publicKey: Buffer.from(storedCredential.publicKey, "base64url"),
    counter: storedCredential.counter,
    transports: toTransports(storedCredential.transports),
  };

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: clientData.challenge,
    expectedOrigin: getOrigin(req),
    expectedRPID: getRpID(req),
    credential,
  });
  if (!result.verified) return { verified: false };
  return { verified: true, newCounter: result.authenticationInfo.newCounter };
}

// Friendly device label derived from the User-Agent at registration time,
// since WebAuthn itself never reports a human-readable device name.
export function labelFromUserAgent(ua: string | undefined): string {
  if (!ua) return "Device";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android device";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "Device";
}
