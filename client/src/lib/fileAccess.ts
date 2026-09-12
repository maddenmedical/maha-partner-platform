const API_BASE = "__PORT_5001__".startsWith("__") ? "" : "__PORT_5001__";

// Files are served by an authenticated proxy that requires the session
// cookie, so a plain <a href> can't reach them cleanly. This fetches the file
// with the cookie included and opens it in a new tab via a blob URL.
export async function openAuthedFile(url: string): Promise<void> {
  const res = await fetch(`${API_BASE}${url}`, { credentials: "include" });
  if (!res.ok) {
    let message = "Could not open file";
    try {
      const data = await res.json();
      message = data.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const win = window.open(objectUrl, "_blank");
  if (!win) {
    // Popup blocked — fall back to a download.
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke after a delay so the opened tab has time to load the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// Same authenticated-fetch approach as openAuthedFile, but always forces a
// save-as download with the given filename instead of opening a viewer tab.
export async function downloadAuthedFile(url: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${url}`, { credentials: "include" });
  if (!res.ok) {
    let message = "Could not download file";
    try {
      const data = await res.json();
      message = data.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
