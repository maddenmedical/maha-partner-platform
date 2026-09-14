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

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
