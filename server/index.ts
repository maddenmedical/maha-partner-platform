import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { storage, sqliteDb } from "./storage";
import { startCaseDiscussionScheduler } from "./caseDiscussionScheduler";
import { startBackupScheduler } from "./backupScheduler";
import { startNotificationScheduler } from "./notificationScheduler";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

// Safety net: Node terminates the whole process on an unhandled promise
// rejection or uncaught exception by default. Route handlers here are async
// functions without individual try/catch, so any unexpected throw (e.g. a
// "no such column" error from schema drift, as previously happened in
// production -- see server/autoMigrate.ts) becomes an unhandled rejection
// that would otherwise kill the process and 503 every subsequent request
// until restart, immediately crashing again. Log and keep serving instead.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled-rejection] request handler threw without being caught:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught-exception] non-fatal, process kept alive:", err);
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Start the in-process case-discussion notification scheduler. Wrapped so a
  // failure here never prevents the server from booting.
  try {
    startCaseDiscussionScheduler(storage);
  } catch (err) {
    console.error("[case-discussion-scheduler] failed to start:", err);
  }

  // Start the in-process Google Drive database-backup scheduler (every 4 hours,
  // plus one immediate backup on boot). Wrapped so a failure never prevents the
  // server from booting.
  try {
    startBackupScheduler(sqliteDb);
  } catch (err) {
    console.error("[backup] failed to start scheduler:", err);
  }

  // Start the in-process referral/order email-notification scheduler (polls
  // every 2 minutes for new, unnotified rows and emails the relevant MAHA
  // team addresses). Wrapped so a failure here never prevents server boot.
  try {
    startNotificationScheduler(storage);
  } catch (err) {
    console.error("[notification-scheduler] failed to start:", err);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
