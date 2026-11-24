import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {chatAuthorLabel} from "./authorPresentation";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatComposer, type ReplyContext } from "./ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "./ChatMessageBubble";
import { Search, Star, Paperclip, ArrowDown } from "lucide-react";

type Conversation = { messages: ChatMessageWithMeta[]; linkedThreadId?: number | null };
type Payload = { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string; replyToMessageId?: number };

// The same controls on both sides, but every request stays invitation-scoped.
export function useInvitationFilters(id?:string){
  const [search,setSearch]=useState(""),[filter,setFilter]=useState<"all"|"starred"|"files">("all");
  useEffect(()=>{setSearch("");setFilter("all");},[id]);
  return {search,setSearch,filter,setFilter};
}
type Filters=ReturnType<typeof useInvitationFilters>;
export function InvitationFilters({filters:{search,setSearch,filter,setFilter}}:{filters:Filters}){
  return <div className="space-y-2">
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4"/><Input aria-label="Search this conversation" placeholder="Search this chat" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9" data-testid="input-invitation-search"/></div>
    <div className="flex gap-2">{(["starred","files"] as const).map(k=><Button key={k} size="sm" variant={filter===k?"secondary":"outline"} aria-pressed={filter===k} onClick={()=>setFilter(filter===k?"all":k)} data-testid={`button-invitation-${k}`}>{k==="starred"?<><Star/>Starred</>:<><Paperclip/>Files</>}</Button>)}</div>
  </div>;
}
export function InvitationConversation({ inviteId, admin = false, shared=false, closed = false,filters:{search,setSearch,filter,setFilter} }: {
  inviteId: string; admin?: boolean; shared?:boolean; closed?: boolean; filters:Filters;
}) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const endpoint = `${admin ? "/api/admin/guest-chats" : "/api/guest-chat"}/${inviteId}`;
  const queryKey = admin ? ["/api/admin/guest-chats", inviteId] : [endpoint];
  const chat = useQuery<Conversation>({ queryKey, refetchInterval: 4000, retry: false });
  const [replying, setReplying] = useState<ReplyContext | null>(null);
  const [sending, setSending] = useState(false), [error, setError] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null), [working, setWorking] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), following = useRef(true);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const messages = chat.isError?[]:chat.data?.messages || [];
  const own=(m:ChatMessageWithMeta)=>admin?m.senderRole==="admin"&&m.senderId===user?.id:shared?!!m.mineBySharedBrowser:m.senderRole==="guest"&&!m.sharedAuthor;
  const readOnly = closed || !!chat.data?.linkedThreadId;
  const shown = messages.filter(m =>
    (filter !== "starred" || m.flaggedByMe) && (filter !== "files" || !!m.attachmentUrl) &&
    `${m.body} ${m.attachmentName || ""} ${m.senderName}`.toLowerCase().includes(search.toLowerCase()));
  const snippet = (m: ChatMessageWithMeta) => m.deletedAt ? "This message was deleted." : m.body || m.attachmentName || "Attachment";
  function latest() {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    following.current = true; setNewMessages(false);
  }
  useEffect(() => {
    if (following.current && !search && filter === "all") requestAnimationFrame(latest);
    else if (messages.length) setNewMessages(true);
  }, [messages.length]);
  async function refresh() {
    await cache.invalidateQueries({ queryKey });
    if (admin) await cache.invalidateQueries({ queryKey: ["/api/admin/guest-chats"], exact: true });
  }
  async function change(method: string, path: string, data?: unknown) {
    setError("");
    try { await apiRequest(method, endpoint + path, data); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); throw e; }
  }
  const toggle = (path: string, data?: unknown) => { void change("POST", path, data).catch(() => {}); };
  async function send(payload: Payload) {
    setSending(true);
    const key = JSON.stringify(payload);
    if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
    try {
      await change("POST", admin ? "/reply" : "/message", { ...payload, requestId: attempt.current.requestId });
      attempt.current = null; following.current = true; requestAnimationFrame(latest);
    } finally { setSending(false); }
  }
  return <section aria-label={admin ? "Guest conversation" : "Conversation"} className="invitation-chat flex flex-1 min-h-0 min-w-0 flex-col gap-2 px-2 pt-2 sm:px-4 overflow-hidden">
    {(search||filter!=="all")&&<Button size="sm" variant="outline" className="self-start" onClick={()=>{setSearch("");setFilter("all");}}>Clear {filter==="all"?"search":filter+" filter"}</Button>}
    {chat.error && <div role="alert" className="rounded border p-3 text-sm">
      <p>{chat.error.message}</p>
      <Button variant="outline" onClick={() => chat.refetch()}>Try again</Button>
    </div>}
    <div ref={scroll} role="log" aria-label="Messages" tabIndex={0} data-testid="invitation-messages"
      onScroll={() => { const el = scroll.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="flex flex-1 min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain bg-muted/20 px-2 py-3 sm:p-4">
      {chat.isLoading && <p className="text-sm">Loading conversation…</p>}
      {!chat.isLoading && !shown.length && <p className="text-sm text-muted-foreground">
        {search || filter !== "all" ? "No matching messages. Try another search or filter." : "Your conversation starts here."}
      </p>}
      {shown.map(m => {
        const original = messages.find(item => item.id === m.replyToMessageId);
        const isMe = own(m);
        return <ChatMessageBubble key={m.id} message={m} isMe={isMe} isAdmin={admin} compact disableMp3 linkify
          onToggleFlag={id => toggle(`/messages/${id}/star`)}
          onReact={(id, emoji) => toggle(`/messages/${id}/reaction`, { emoji })}
          onReply={readOnly ? undefined : id => {
            const target = messages.find(item => item.id === id);
            if (target) setReplying({ id, senderName: chatAuthorLabel(target,own(target)), snippet: snippet(target).slice(0, 160) });
          }}
          quoted={original ? { senderName: chatAuthorLabel(original,own(original)), snippet: snippet(original).slice(0, 160) } : null}
          onEdit={admin && isMe && !readOnly ? (id, body) => change("PATCH", `/messages/${id}`, { body }) : undefined}
          onDelete={admin && !readOnly ? setDeleting : undefined} />;
      })}
    </div>
    {newMessages && <Button variant="outline" className="w-full" onClick={() => { setFilter("all"); setSearch(""); requestAnimationFrame(latest); }}>
      <ArrowDown className="mr-2 h-4 w-4" />Latest messages
    </Button>}
    {deleting !== null && <div role="alertdialog" aria-label="Delete message confirmation" className="rounded-lg border p-3 space-y-2">
      <p className="text-sm">Delete this message from the conversation? A deleted-message marker will remain.</p>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={working} onClick={async () => {
          setWorking(true);
          try { await change("DELETE", `/messages/${deleting}`); setDeleting(null); } catch { /* error remains visible */ }
          finally { setWorking(false); }
        }}>Delete message</Button>
        <Button variant="outline" disabled={working} onClick={() => setDeleting(null)}>Cancel</Button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!readOnly && <ChatComposer uploadUrl={`${endpoint}/upload`} threadId={0} onSend={send}
      sending={sending} disabled={!!chat.error || chat.isLoading} testIdPrefix={admin ? "invite-admin" : "invite-guest"}
      replyingTo={replying} onCancelReply={() => setReplying(null)} placeholder="Write a message…"
      maxLength={5000} maxFileBytes={20 * 1024 * 1024} maxRecordingSeconds={180}
      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" />}
  </section>;
}
