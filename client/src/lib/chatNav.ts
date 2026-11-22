// Tiny module-level pub/sub for passing a target chat thread id across page
// navigations. NOT localStorage (banned in this sandboxed app) -- this is
// pure in-memory JS state, which is fine because it only needs to survive a
// single client-side route change triggered by the same click that set it.
let pendingThreadId: number | null = null;
let invitationAccount:number|null=null;
let draftTransfer:{thread:number;text:string}|null=null;
export function carryInvitationDraft(thread:number,text:string){draftTransfer=text?{thread,text}:null;}
export function takeInvitationDraft(){const draft=draftTransfer;draftTransfer=null;return draft;}
export function markInvitationSaved(userId:number) { invitationAccount=userId; }
export function isInvitationSaved(userId?:number) { return invitationAccount!==null && invitationAccount===userId; }
export function clearInvitationSaved() { invitationAccount=null; }

export function setPendingThreadId(id: number) {
  pendingThreadId = id;
  window.dispatchEvent(new Event("maha-open-chat-thread"));
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
