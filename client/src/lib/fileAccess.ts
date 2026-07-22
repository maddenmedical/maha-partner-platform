import { getAuthToken } from "./queryClient";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Files are served by an authenticated proxy that requires the in-memory Bearer
// token, so a plain <a href> can't reach them. This fetches the file with the
// auth header and opens it in a new tab via a blob URL.
export async function openAuthedFile(url: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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
