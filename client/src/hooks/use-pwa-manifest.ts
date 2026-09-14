import { useEffect } from "react";

// Twin-manifest trick: this single-origin app serves two different roles
// (partner-facing vs admin), and PWA install icons come from whichever
// manifest is linked in <head> at the moment the browser reads it. Swapping
// the <link rel="manifest"> (and the iOS apple-touch-icon, which Safari
// reads directly instead of the manifest) based on the signed-in user's
// role lets each role install with its own icon — MAHA yellow for
// partners/students, the existing beige mark for admins — without touching
// routes or anything else about how the app works.
//
// The admin manifest's scope/start_url point at /admin/ (its own PWA scope,
// distinct from the partner manifest's root scope) so Android/iOS treat the
// two installs as genuinely separate apps and route a shared link to the
// correct one instead of guessing. Landing on /admin/ is therefore the
// strongest signal and wins over everything else, including role — it's
// the URL the user (or their installed icon) actually asked for.
//
// Phase 2 of the trick: a direct install link (?app=admin / ?app=partner,
// e.g. sent to a partner before they've ever logged in) takes priority over
// the signed-in role, but not over the /admin/ path. This keeps the icon
// stable and correct even for a signed-out visitor — phase 1 is the
// blocking inline script in client/index.html that does the same swap
// before this hook (or any JS bundle) even runs, so the browser never has a
// chance to read the wrong manifest for its install prompt.
export function usePwaManifest(isAdmin: boolean) {
  useEffect(() => {
    const isAdminPath = /^\/admin(\/|$)/.test(window.location.pathname);
    const appParam = new URLSearchParams(window.location.search).get("app");
    const admin = isAdminPath ? true : appParam === "admin" ? true : appParam === "partner" ? false : isAdmin;
    const manifestHref = admin ? "/manifest-admin.json" : "/manifest.json";
    const touchIconHref = admin ? "/icon-192-admin.png" : "/icon-192.png";
    const appTitle = admin ? "MAHA Admin" : "MAHA";

    const manifestLink = document.querySelector<HTMLLinkElement>("link[rel='manifest']");
    if (manifestLink && manifestLink.getAttribute("href") !== manifestHref) {
      manifestLink.setAttribute("href", manifestHref);
    }

    const touchIconLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (touchIconLink && touchIconLink.getAttribute("href") !== touchIconHref) {
      touchIconLink.setAttribute("href", touchIconHref);
    }

    const webAppTitleMeta = document.querySelector<HTMLMetaElement>(
      "meta[name='apple-mobile-web-app-title']"
    );
    if (webAppTitleMeta && webAppTitleMeta.getAttribute("content") !== appTitle) {
      webAppTitleMeta.setAttribute("content", appTitle);
    }
  }, [isAdmin]);
}
