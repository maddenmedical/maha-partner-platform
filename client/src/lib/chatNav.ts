// Tiny module-level pub/sub for passing a target chat thread id across page
// navigations. NOT localStorage (banned in this sandboxed app) -- this is
// pure in-memory JS state, which is fine because it only needs to survive a
// single client-side route change triggered by the same click that set it.
let pendingThreadId: number | null = null;

export function setPendingThreadId(id: number) {
  pendingThreadId = id;
}

export function consumePendingThreadId(): number | null {
  const url = new URL(window.location.href);
  const linkedId = Number(url.searchParams.get("thread"));
  const id = pendingThreadId ?? (Number.isSafeInteger(linkedId) && linkedId > 0 ? linkedId : null);
  if (url.searchParams.has("thread")) {
    url.searchParams.delete("thread");
    window.history.replaceState(window.history.state, "", url);
  }
  pendingThreadId = null;
  return id;
}
