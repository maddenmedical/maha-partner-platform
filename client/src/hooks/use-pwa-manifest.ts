import { useEffect } from "react";

// Twin-manifest trick: this single-origin app serves two different roles
// (partner-facing vs admin), and PWA install icons come from whichever
// manifest is linked in <head> at the moment the browser reads it. Swapping
// the <link rel="manifest"> (and the iOS apple-touch-icon, which Safari
// reads directly instead of the manifest) based on the signed-in user's
// role lets each role install with its own icon — MAHA yellow for
// partners/students, the existing beige mark for admins — without touching
// routes, scope, or anything else about how the app works.
export function usePwaManifest(isAdmin: boolean) {
  useEffect(() => {
    const manifestHref = isAdmin ? "/manifest-admin.json" : "/manifest.json";
    const touchIconHref = isAdmin ? "/icon-192-admin.png" : "/icon-192.png";
    const appTitle = isAdmin ? "MAHA Admin" : "MAHA";

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
