import Stripe from "stripe";

// The Stripe secret key is intentionally optional. The business owner has not
// provided one yet, so every payment code path must degrade gracefully: callers
// check `isStripeConfigured()` (or a null return from `getStripe()`) and surface
// a "payments not configured" message instead of crashing. Once STRIPE_SECRET_KEY
// is added to .env, the full checkout flow activates with no other code changes.
let cached: Stripe | null | undefined;

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key) : null;
  return cached;
}
