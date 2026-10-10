import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);

// Register the push service worker. Guarded so it no-ops in browsers (or
// sandboxed iframes) that don't support service workers.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    try {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal: push simply stays unavailable if registration fails.
      });
    } catch {
      // Restricted contexts can throw when reading serviceWorker itself.
      // Keep the application and persistent in-app alerts available.
    }
  });
}
