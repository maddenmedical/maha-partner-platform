import express from 'express';
import type { Express } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // The admin PWA's manifest scope is "/admin/" (trailing slash), which is
  // what Android/iOS actually check when deciding which installed app owns
  // a shared link. A bare "/admin" (no slash) is still outside that scope,
  // so normalize it before the catch-all below would otherwise serve
  // index.html directly at the un-scoped URL. Express treats "/admin" and
  // "/admin/" as the same route by default (trailing slash is optional in
  // its path matching), so this checks req.path exactly rather than relying
  // on the route pattern — a pattern-based match here would redirect
  // "/admin/" to itself in an infinite loop.
  app.use((req, res, next) => {
    if (req.path === "/admin") return res.redirect(308, "/admin/");
    next();
  });

  // PWA manifests, service worker, and icon files must NEVER be cached by
  // the browser (or any CDN in front of it). These are exactly the files
  // that decide what icon/name shows on a partner's or admin's home screen,
  // and without an explicit no-store instruction, browsers are legally free
  // to keep serving an old cached copy for hours or days after we deploy a
  // fix — which is indistinguishable from "the fix didn't work" from the
  // user's side. This forces every request for these files to always hit
  // the server fresh, so a deployed icon/manifest fix reaches every device
  // the next time it opens the app, with zero action needed from the user.
  const NEVER_CACHE = new Set([
    "/manifest.json",
    "/manifest-admin.json",
    "/sw.js",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-192-admin.png",
    "/icon-512-admin.png",
    "/favicon.png",
  ]);
  app.use((req, res, next) => {
    if (NEVER_CACHE.has(req.path)) {
      res.setHeader("Cache-Control", "no-store, must-revalidate");
    }
    next();
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (req, res) => {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
