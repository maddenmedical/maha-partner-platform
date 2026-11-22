import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { AdminChatRecipient } from "@shared/schema";
import { InvitationConversation, InvitationFilters, useInvitationFilters } from "./InvitationConversation";
import {AttachmentNote,ChatTools,useChatViewport} from "./ChatFrame";
import {InvitationInstall} from "./InvitationInstall";
type Invitation = { id: string; label: string; topic: string; unread: boolean; messageCount: number;
  canRemind:boolean; guestAccessEnded:boolean; openedAt:number|null; linkSharing:boolean;
  linkedThreadId: number | null; intendedUserId: number | null; declinedAt: number | null; revokedAt: number | null };
export function AdminChatInvites({ onOpenChat }: { onOpenChat: (id: number) => void }) {
  const [open, setOpen] = useState(false), [create, setCreate] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Invitation | null>(null), [search, setSearch] = useState("");
  const [partner, setPartner] = useState<AdminChatRecipient | null>(null);
  const [label, setLabel] = useState(""), [topic, setTopic] = useState("Conversation with MAHA");
  const [message, setMessage] = useState("Thank you for continuing our conversation here. How can we help?");
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  const [linking, setLinking] = useState(false), [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [restoreCode,setRestoreCode]=useState(""),[verified,setVerified]=useState(false),[approved,setApproved]=useState(false);
  useEffect(()=>{setRestoreCode("");setVerified(false);setApproved(false);},[selected?.id,open]);
  const filters=useInvitationFilters(selected?.id);
  useChatViewport(open&&!!selected&&!create&&!url);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
      dialogRef.current?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [create, selected?.id, url]);
  const queryClient = useQueryClient();
  const invites = useQuery<Invitation[]>({ queryKey: ["/api/admin/guest-chats"], refetchInterval: 5000 });
  const recipients = useQuery<AdminChatRecipient[]>({ queryKey: ["/api/admin/chat/recipients"], enabled: open });
  const fresh = invites.data?.find(i => i.id === selected?.id) || selected;
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["/api/admin/guest-chats"] }); };
  async function act(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError("");
    try { await fn(); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const filtered = recipients.data?.filter(p => `${p.name} ${p.email} ${p.businessName || ""}`.toLowerCase().includes(search.toLowerCase())) || [];
  const unread = invites.data?.filter(i => i.unread && !i.linkedThreadId).length || 0;
  const choosePartner = <div className="space-y-2">
    <Label htmlFor="invite-partner-search">Find an existing partner (optional)</Label>
    <Input id="invite-partner-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, clinic or email" />
    {partner ? <div className="rounded border p-3 text-sm"><p>{partner.name}</p><p className="break-all text-muted-foreground">{partner.email}</p><Button size="sm" variant="ghost" onClick={() => setPartner(null)}>Change selection</Button></div> :
      <div role="listbox" aria-label="Matching partners" className="max-h-36 overflow-y-auto rounded border">
        {filtered.slice(0, 30).map(p => <button type="button" role="option" aria-selected={false} key={p.id} className="block w-full border-b p-2 text-left text-sm hover:bg-muted"
          onClick={() => { setPartner(p); if (!label) setLabel(p.name); }}><span className="block">{p.name}</span><span className="block break-all text-xs text-muted-foreground">{p.email}</span></button>)}
        {recipients.isLoading ? <p className="p-2 text-sm">Loading partners…</p> : !filtered.length && <p className="p-2 text-sm">No matching partners</p>}
      </div>}
  </div>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}>Chat invitations{unread > 0 ? ` (${unread} new)` : ""}</Button>
    <DialogContent ref={dialogRef} tabIndex={-1} className={selected&&!create&&!url?"chat-invite-modal":"w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-lg grid-cols-[minmax(0,1fr)] [&>*]:min-w-0 [&_button]:whitespace-normal [&_button]:h-auto [&_button]:min-h-10"}>
      <DialogHeader className={selected&&!create&&!url?"sr-only":""}><DialogTitle>Chat invitations</DialogTitle><DialogDescription>Move a WhatsApp conversation into MAHA. New guests chat first and keep their conversation by verifying their account.</DialogDescription></DialogHeader>
      {url ? <div className="space-y-4">
        <p className="text-sm">Share this personal invitation only with the intended recipient. First use must be within 7 days. Once started, this same link can reopen or securely restore the existing chat. Copy it now; it is not shown again after you leave this screen.</p>
        <Label htmlFor="chat-invite-link">Invitation link</Label><Input id="chat-invite-link" readOnly value={url} onFocus={e => e.target.select()} />
        <div className="flex flex-wrap gap-2">
          <Button asChild><a href={`https://wa.me/?text=${encodeURIComponent(`Please continue our conversation in MAHA. You can start chatting here without creating a password: ${url}`)}`} target="_blank" rel="noopener noreferrer">Share via WhatsApp</a></Button>
          <Button variant="outline" onClick={() => act(async () => { await navigator.clipboard.writeText(url); setCopied(true); })}>{copied ? "Copied" : "Copy link"}</Button>
        </div>
        <Button variant="ghost" onClick={() => { setUrl(""); setCreate(false); }}>Back to invitations</Button>
      </div> : create ? <div className="space-y-3">
        {choosePartner}
        <p className="text-xs text-muted-foreground">{partner ? "The invitation is bound to this account. A signed-in partner goes straight to the new chat; otherwise they can chat as a guest before verifying." : "No partner selected: the guest can register after chatting and will be approved automatically."}</p>
        <Label htmlFor="invite-label">Internal contact label</Label><Input id="invite-label" value={label} onChange={e => setLabel(e.target.value)} maxLength={120} />
        <Label htmlFor="invite-topic">Chat subject</Label><Input id="invite-topic" value={topic} onChange={e => setTopic(e.target.value)} maxLength={160} />
        <Label htmlFor="invite-message">First message</Label><Textarea id="invite-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={5000} />
        <p className="text-xs text-muted-foreground">Guests are unverified until they keep the chat. Do not put patient details or confidential account information in the invitation or first message.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !label.trim() || !topic.trim() || !message.trim()} onClick={() => act(async () => {
          const response = await apiRequest("POST", "/api/admin/guest-chats", { label, topic, message, intendedUserId: partner?.id ?? null });
          const result = await response.json(); setUrl(`${window.location.origin}${window.location.pathname}${result.path.slice(1)}`); setCopied(false);
        })}>Create invitation link</Button><Button variant="ghost" disabled={busy} onClick={() => setCreate(false)}>Cancel</Button></div>
      </div> : selected ? <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-1 border-b pl-1 pr-12 py-1 shrink-0">
        <Button variant="ghost" size="sm" aria-label="Back to invitations" onClick={() => { setSelected(null); setLinking(false); }}>Back</Button>
        <div className="mr-auto min-w-0"><h3 className="font-semibold truncate">{fresh?.label}</h3><p className="text-xs text-muted-foreground truncate">{fresh?.topic}</p></div>
        <InvitationInstall/><ChatTools label="Invitation options"><InvitationFilters filters={filters}/><AttachmentNote/>
        <p className="rounded border p-2 text-xs text-muted-foreground">Guest messages before verification are not proof of identity. Retained conversations are visible to admins, including when a guest declines registration.</p>
        {fresh?.canRemind && <div className="rounded-md border p-3 space-y-1">
          <Button variant="outline" size="sm" asChild><a target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
            href={`https://wa.me/?text=${encodeURIComponent("MAHA has replied. Please open your MAHA chat on the device where you keep it to read the reply.")}`}>Remind via WhatsApp</a></Button>
          <p className="text-xs text-muted-foreground">Choose the original recipient in WhatsApp, review the draft, then send it yourself. No phone number or chat content is shared by MAHA.</p>
        </div>}
        {fresh?.openedAt&&!fresh.linkSharing&&!fresh.linkedThreadId&&!fresh.declinedAt&&!fresh.revokedAt&&<details className="text-sm">
          <summary className="cursor-pointer font-medium">Restore access to this same chat</summary>
          <div className="space-y-2 pt-2"><p>Ask the original recipient to reopen their personal link, choose Restore this chat, and give you the matching code in your existing, independently verified WhatsApp conversation. Never approve a code from a new contact or from the link alone.</p>
          <Label htmlFor="restore-match">Matching code from the verified recipient</Label><Input id="restore-match" autoComplete="off" maxLength={18} value={restoreCode} onChange={e=>{setRestoreCode(e.target.value);setVerified(false);setApproved(false);}}/>
          <label className="flex gap-2"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>I verified the original recipient independently and matched their code. When claimed, this gives that browser the entire chat and replaces the previous guest device.</label>
          <Button disabled={busy||!verified||!/^[a-f0-9]{12}$/i.test(restoreCode.replace(/[\s-]/g,""))} onClick={()=>act(async()=>{await apiRequest("POST",`/api/admin/guest-chats/${selected.id}/approve-restore`,{code:restoreCode,verifiedOriginalContact:true});setApproved(true);setRestoreCode("");setVerified(false);})}>Approve this browser</Button>
          {approved&&<p role="status">Approved. The recipient can reopen this same chat on the browser that requested the code.</p>}</div>
        </details>}
        {fresh?.linkedThreadId ? <Button onClick={() => { setOpen(false); onOpenChat(fresh.linkedThreadId!); }}>Open linked member chat</Button> : <>
          {fresh?.linkSharing?<p className="text-sm">Turn off link sharing before connecting this conversation to a partner.</p>:!linking ? <Button variant="outline" onClick={() => { setLinking(true); setPartner(null); setSearch(""); }}>Connect to a partner account</Button> : <div className="rounded border p-3 space-y-3">
            {choosePartner}<p className="text-sm">Confirm the identity first. This will give the selected partner access to all messages in this conversation and end guest access.</p>
            <Button disabled={busy || !partner} onClick={() => act(async () => {
              const response = await apiRequest("POST", `/api/admin/guest-chats/${selected.id}/link`, { userId: partner!.id });
              const result = await response.json(); await queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] }); setOpen(false); onOpenChat(result.threadId);
            })}>Confirm and connect conversation</Button>
          </div>}
          {!fresh?.revokedAt && <details className="text-sm"><summary className="cursor-pointer">End invitation access</summary><p className="my-2">This disables the link and guest access. The conversation stays available to admins.</p><Button variant="outline" disabled={busy} onClick={() => act(async () => { await apiRequest("POST", `/api/admin/guest-chats/${selected.id}/revoke`); })}>Revoke invitation</Button></details>}
        </>}
        </ChatTools></header>
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        <InvitationConversation key={selected.id} inviteId={selected.id} filters={filters} admin closed={!!fresh?.declinedAt || !!fresh?.revokedAt || !!fresh?.linkedThreadId} />
      </div> : <div className="space-y-3">
        <Button onClick={() => { setCreate(true); setSelected(null); setPartner(null); setSearch(""); setLabel(""); setError(""); }}>New WhatsApp invitation</Button>
        {invites.isLoading ? <p>Loading invitations…</p> : !invites.data?.length ? <p className="text-sm text-muted-foreground">No invitations yet.</p> : invites.data.map(i =>
          <div key={i.id} className="rounded-lg border p-3"><button className="block w-full text-left hover:bg-muted" onClick={() => { setSelected(i); setLinking(false); }}>
            <span className="font-medium">{i.label}{i.unread ? " · New message" : ""}</span><span className="block text-sm text-muted-foreground">{i.topic}</span>
            <span className="text-xs text-muted-foreground">{i.linkedThreadId ? "Linked to member" : i.declinedAt ? "Declined registration · retained" : i.revokedAt ? "Revoked · retained" : "Awaiting account verification"} · {i.messageCount} messages</span>
          </button>{i.openedAt&&!i.linkedThreadId&&!i.declinedAt&&!i.revokedAt&&<details className="mt-2 text-sm"><summary>Link access: {i.linkSharing?"Anyone with the link":"Private"}</summary>
            <p className="my-2">Anyone with the link can read the entire existing conversation, including files, and reply without proving their identity. Turning sharing off ends shared browser access.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={()=>act(async()=>{await apiRequest("POST",`/api/admin/guest-chats/${i.id}/link-sharing`,{enabled:!i.linkSharing,confirmExposure:!i.linkSharing});})}>{i.linkSharing?"Turn off shared access":"Allow anyone with this link to read and reply"}</Button></details>}</div>)}
      </div>}
      {error && !selected && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
