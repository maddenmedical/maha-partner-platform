// Tiny module-level pub/sub for passing a target chat thread id across page
// navigations. NOT localStorage (banned in this sandboxed app) -- this is
// pure in-memory JS state, which is fine because it only needs to survive a
// single client-side route change triggered by the same click that set it.
let pendingThreadId: number | null = null;

export function setPendingThreadId(id: number) {
  pendingThreadId = id;
}

export function consumePendingThreadId(): number | null {
  const id = pendingThreadId;
  pendingThreadId = null;
  return id;
}
