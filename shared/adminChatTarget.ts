// These are authenticated admin routes, never bearer URLs. Do not put names,
// message text, invitation secrets, or patient identifiers in the URL.
type Kind = "invitation" | "thread" | "dm" | "room";
export function adminChatPath(kind: Kind, id: string | number) {
  const value = String(id);
  if (kind === "invitation" ? !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
    : kind === "room" ? value !== "main"
    : !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
  return `/admin/chat/${kind}/${value}`;
}
export function adminChatDestination(url: URL) {
  const path = url.hash.slice(1);
  if (path === "/admin/chat" && url.searchParams.has("thread")) {
    return adminChatPath("thread", url.searchParams.get("thread")!);
  }
  const m = /^\/admin\/chat\/(invitation|thread|dm|room)\/([^/]+)$/.exec(path);
  return m && adminChatPath(m[1] as Kind, m[2]);
}
