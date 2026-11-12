import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
export function InvitationConversation({ inviteId, admin = false, closed = false }: {
  inviteId: string; admin?: boolean; closed?: boolean;
}) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const endpoint = `${admin ? "/api/admin/guest-chats" : "/api/guest-chat"}/${inviteId}`;
  const queryKey = admin ? ["/api/admin/guest-chats", inviteId] : [endpoint];
  const chat = useQuery<Conversation>({ queryKey, refetchInterval: 4000, retry: false });
  const [search, setSearch] = useState(""), [filter, setFilter] = useState<"all" | "starred" | "files">("all");
  const [replying, setReplying] = useState<ReplyContext | null>(null);
  const [sending, setSending] = useState(false), [error, setError] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null), [working, setWorking] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), following = useRef(true);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const messages = chat.data?.messages || [];
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
  return <section aria-label={admin ? "Guest conversation" : "Conversation"} className="min-w-0 space-y-3">
    <div className="flex min-w-0 flex-wrap gap-2">
      <div className="relative min-w-0 flex-1 basis-36">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search this conversation" placeholder="Search this chat" value={search}
          onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="input-invitation-search" />
      </div>
      <Button variant={filter === "starred" ? "secondary" : "outline"} aria-pressed={filter === "starred"}
        onClick={() => setFilter(filter === "starred" ? "all" : "starred")} data-testid="button-invitation-starred">
        <Star className="mr-1.5 h-4 w-4" />Starred
      </Button>
      <Button variant={filter === "files" ? "secondary" : "outline"} aria-pressed={filter === "files"}
        onClick={() => setFilter(filter === "files" ? "all" : "files")} data-testid="button-invitation-files">
        <Paperclip className="mr-1.5 h-4 w-4" />Files
      </Button>
    </div>
    {chat.error && <div role="alert" className="rounded border p-3 text-sm">
      <p>{chat.error.message}</p>
      <Button variant="outline" onClick={() => chat.refetch()}>Try again</Button>
    </div>}
    <div ref={scroll} role="log" aria-label="Messages" tabIndex={0} data-testid="invitation-messages"
      onScroll={() => { const el = scroll.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="flex min-h-48 max-h-[45dvh] min-w-0 flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-3 sm:p-4">
      {chat.isLoading && <p className="text-sm">Loading conversation…</p>}
      {!chat.isLoading && !shown.length && <p className="text-sm text-muted-foreground">
        {search || filter !== "all" ? "No matching messages. Try another search or filter." : "Your conversation starts here."}
      </p>}
      {shown.map(m => {
        const original = messages.find(item => item.id === m.replyToMessageId);
        const isMe = admin ? m.senderRole === "admin" && m.senderId === user?.id : m.senderRole === "guest";
        return <ChatMessageBubble key={m.id} message={m} isMe={isMe} isAdmin={admin} compact disableMp3 linkify
          onToggleFlag={id => toggle(`/messages/${id}/star`)}
          onReact={(id, emoji) => toggle(`/messages/${id}/reaction`, { emoji })}
          onReply={readOnly ? undefined : id => {
            const target = messages.find(item => item.id === id);
            if (target) setReplying({ id, senderName: target.senderRole === "guest" && !admin ? "You" : target.senderName, snippet: snippet(target).slice(0, 160) });
          }}
          quoted={original ? { senderName: original.senderRole === "guest" && !admin ? "You" : original.senderName, snippet: snippet(original).slice(0, 160) } : null}
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
    {!readOnly && <ChatComposer uploadUrl={`${endpoint}/upload`} threadId={0} onSend={send}
      sending={sending} disabled={!!chat.error || chat.isLoading} testIdPrefix={admin ? "invite-admin" : "invite-guest"}
      replyingTo={replying} onCancelReply={() => setReplying(null)} placeholder="Write a message…"
      maxLength={5000} maxFileBytes={20 * 1024 * 1024} maxRecordingSeconds={180}
      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" />}
    {!readOnly && <p className="text-xs text-muted-foreground">Photos, documents, video and voice notes · up to 20 MB per file. Please avoid identifiable patient information before verification.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
