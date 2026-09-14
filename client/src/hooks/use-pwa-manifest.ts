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
//
// IMPORTANT — icon cache-busting: as of 2026, Chrome's WebAPK update check
// treats an icon as unchanged whenever its URL is unchanged, even if the
// PNG bytes behind that URL are different (it no longer downloads icons to
// compare pixels). That means overwriting icon-192.png / icon-512.png /
// icon-192-admin.png / icon-512-admin.png in place will NEVER reach an
// already-installed home screen icon, no matter how long you wait or how
// aggressively you disable HTTP caching. Whenever these icon files change,
// you MUST also bump the "?v=N" query suffix everywhere the filename is
// referenced (this file, client/index.html x2, manifest.json,
// manifest-admin.json) so Chrome's automatic manifest check — which runs
// roughly every 24h the app is opened — actually detects a change and
// mints an updated WebAPK, typically within a day, with no user action.
export function usePwaManifest(isAdmin: boolean) {
  useEffect(() => {
    const isAdminPath = /^\/admin(\/|$)/.test(window.location.pathname);
    const appParam = new URLSearchParams(window.location.search).get("app");
    const admin = isAdminPath ? true : appParam === "admin" ? true : appParam === "partner" ? false : isAdmin;
    const manifestHref = admin ? "/manifest-admin.json" : "/manifest.json";
    const touchIconHref = admin ? "/icon-192-admin.png?v=2" : "/icon-192.png?v=2";
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
