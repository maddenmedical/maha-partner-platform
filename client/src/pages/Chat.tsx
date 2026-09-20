import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MessageSquare, Loader2, Plus, Stethoscope, Search, Star, ClipboardPlus, ArrowLeft, Archive, Undo2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { consumePendingThreadId } from "@/lib/chatNav";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { ReferralLinkPanel } from "@/components/chat/ReferralLinkPanel";
import { ReferralFormDialog } from "@/components/chat/ReferralFormDialog";
import { CrossChatSearch } from "@/components/chat/CrossChatSearch";
import { threadMentionLabel, referralMentionLabel, type MentionCandidate } from "@/lib/chatMentions";
import { ChatCommunitySwitcher } from "@/components/ChatCommunitySwitcher";
import type { ChatThread, Referral } from "@shared/schema";

interface ThreadRow extends ChatThread {
  lastMessage?: string;
  lastMessageAt?: number;
  messageCount: number;
  unread?: boolean;
}

export default function Chat({ label = "Chat with MAHA Team" }: { label?: string }) {
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(() => consumePendingThreadId());
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatStep, setNewChatStep] = useState<"choose" | "pick-referral" | "topic">("choose");
  const [newPatientDialogOpen, setNewPatientDialogOpen] = useState(false);
  const [topic, setTopic] = useState("");

  const { data: threads, isLoading } = useQuery<ThreadRow[]>({
    queryKey: ["/api/chat/threads"],
    refetchInterval: 5000,
  });

  // Same query/key ThreadDetail's referral-link panel uses -- react-query
  // dedupes and shares the cache, so this doesn't add an extra request.
  const { data: myReferrals } = useQuery<(Referral & { chatThreadId: number | null })[]>({
    queryKey: ["/api/referrals/mine"],
  });

  // Same query/key MobileAppLayout already polls for the tab-bar dot --
  // shared cache, no extra request -- so the Inbox/Community switcher can
  // show a dot for Community even while sitting on this page.
  const { data: communityUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/community/unread-count"],
    refetchInterval: 15000,
  });
  const hasUnreadCommunity = !!communityUnread?.count;
  const hasUnreadInbox = !!threads?.some((t) => t.unread);

  const createThread = useMutation({
    mutationFn: (topic: string) => apiRequest("POST", "/api/chat/threads", { topic }),
    onSuccess: async (res) => {
      const thread = await res.json();
      setTopic("");
      setNewChatOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      setSelectedThread({ ...thread, messageCount: 0 });
    },
  });

  // Fallback for the rare referral that has no dedicated chat thread yet --
  // creates one and links it via the same merge-safe backend logic used
  // elsewhere, then opens it. In the normal case (referral already has a
  // chatThreadId) this mutation isn't needed -- picking just opens it directly.
  const linkExistingReferralMutation = useMutation({
    mutationFn: async (referral: Referral) => {
      const patientTopic = `Patient: ${referral.patientFirstName} ${referral.patientLastName}`;
      const threadRes = await apiRequest("POST", "/api/chat/threads", { topic: patientTopic });
      const newThread = await threadRes.json();
      const linkRes = await apiRequest("POST", `/api/chat/threads/${newThread.id}/link-referral`, { referralId: referral.id });
      const linkData = await linkRes.json();
      return (linkData.survivingThreadId ?? linkData.thread?.id ?? newThread.id) as number;
    },
    onSuccess: async (threadId) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
      setNewChatOpen(false);
      setPendingSelectId(threadId);
    },
  });

  function handlePickReferral(referral: Referral & { chatThreadId: number | null }) {
    if (referral.chatThreadId) {
      setNewChatOpen(false);
      setPendingSelectId(referral.chatThreadId);
    } else {
      linkExistingReferralMutation.mutate(referral);
    }
  }

  // Keep the selected thread's data in sync as the list refetches (topic,
  // referral link, pending-request flag can all change from actions taken
  // inside ThreadDetail, not just new messages).
  useEffect(() => {
    if (!selectedThread || !threads) return;
    const fresh = threads.find((t) => t.id === selectedThread.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedThread)) {
      setSelectedThread(fresh);
    }
  }, [threads, selectedThread]);

  // Resolves a pending thread id set by another page (e.g. "Open chat" from
  // a referral, or the surviving thread id after a merge) once it shows up
  // in the refetched thread list.
  useEffect(() => {
    if (!pendingSelectId || !threads) return;
    const target = threads.find((t) => t.id === pendingSelectId);
    if (target) {
      setSelectedThread(target);
      setPendingSelectId(null);
    }
  }, [pendingSelectId, threads]);

  function handleCreateThread(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    createThread.mutate(topic.trim());
  }

  return (
    <div className="p-4 flex flex-col h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-9.5rem)] max-w-5xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-chat-title">{label}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Start a new chat for each topic, and jump back into past conversations any time.
          </p>
          <div className="mt-2">
            <ChatCommunitySwitcher active="inbox" hasUnreadInbox={hasUnreadInbox} hasUnreadCommunity={hasUnreadCommunity} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <CrossChatSearch searchUrl="/api/chat/search" onSelectThread={(id) => setPendingSelectId(id)} testIdPrefix="chat-search" />
        <Dialog
          open={newChatOpen}
          onOpenChange={(open) => {
            setNewChatOpen(open);
            if (open) setNewChatStep("choose");
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 shrink-0" data-testid="button-new-chat">
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </DialogTrigger>
          <DialogContent>
            {newChatStep === "choose" && (
              <>
                <DialogHeader>
                  <DialogTitle>Start a new chat</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setNewChatStep("pick-referral")}
                    className="flex items-start gap-3 rounded-lg border border-card-border p-3 text-left hover-elevate active-elevate-2"
                    data-testid="button-choice-existing-referral"
                  >
                    <Stethoscope className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>
                      <span className="text-sm font-medium block">An existing patient referral</span>
                      <span className="text-xs text-muted-foreground">Pick which one to open its chat</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewChatOpen(false);
                      setNewPatientDialogOpen(true);
                    }}
                    className="flex items-start gap-3 rounded-lg border border-card-border p-3 text-left hover-elevate active-elevate-2"
                    data-testid="button-choice-new-patient"
                  >
                    <ClipboardPlus className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>
                      <span className="text-sm font-medium block">A new patient</span>
                      <span className="text-xs text-muted-foreground">Create a patient referral to get started</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewChatStep("topic")}
                    className="flex items-start gap-3 rounded-lg border border-card-border p-3 text-left hover-elevate active-elevate-2"
                    data-testid="button-choice-something-else"
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>
                      <span className="text-sm font-medium block">Something else</span>
                      <span className="text-xs text-muted-foreground">Start a regular chat with the MAHA team</span>
                    </span>
                  </button>
                </div>
              </>
            )}

            {newChatStep === "pick-referral" && (
              <>
                <DialogHeader>
                  <DialogTitle>Which patient referral?</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                  {!myReferrals || myReferrals.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-referrals">
                      You don't have any patient referrals yet.
                    </p>
                  ) : (
                    myReferrals
                      .slice()
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => handlePickReferral(r)}
                          disabled={linkExistingReferralMutation.isPending}
                          className="flex items-center justify-between gap-2 rounded-lg border border-card-border p-2.5 text-left hover-elevate active-elevate-2 disabled:opacity-60"
                          data-testid={`button-pick-referral-${r.id}`}
                        >
                          <span className="text-sm font-medium truncate">{r.patientFirstName} {r.patientLastName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{r.status}</span>
                        </button>
                      ))
                  )}
                </div>
                <DialogFooter className="sm:justify-start">
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setNewChatStep("choose")} data-testid="button-back-new-chat">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </Button>
                </DialogFooter>
              </>
            )}

            {newChatStep === "topic" && (
              <>
                <DialogHeader>
                  <DialogTitle>Start a new chat</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateThread} className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block" htmlFor="chat-topic-input">
                      What would you like to talk about?
                    </label>
                    <Input
                      id="chat-topic-input"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. Order question, Referral follow-up..."
                      autoFocus
                      data-testid="input-chat-topic"
                    />
                  </div>
                  <DialogFooter className="sm:justify-between">
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setNewChatStep("choose")} data-testid="button-back-new-chat">
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </Button>
                    <Button type="submit" disabled={createThread.isPending || !topic.trim()} data-testid="button-create-chat">
                      {createThread.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start chat"}
                    </Button>
                  </DialogFooter>
                </form>
              </>
            )}
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <ReferralFormDialog
        open={newPatientDialogOpen}
        onOpenChange={setNewPatientDialogOpen}
        onSuccess={async (data, openChat) => {
          await queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
          await queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
          if (openChat) setPendingSelectId(data.chatThreadId);
        }}
      />

      <div className="flex flex-1 min-h-0 gap-4">
        <div className="w-full sm:w-72 shrink-0 flex flex-col gap-2 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <>
              <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
              <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
            </>
          ) : !threads || threads.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No chats yet"
              description="Start a new chat above to reach the MAHA team."
            />
          ) : (
            threads
              .slice()
              .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt))
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedThread(t)}
                  className={cn(
                    "text-left rounded-lg border p-3 hover-elevate active-elevate-2",
                    selectedThread?.id === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card",
                    t.kind === "referral" && selectedThread?.id !== t.id && "border-l-2 border-l-primary"
                  )}
                  data-testid={`button-thread-${t.id}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {t.unread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-thread-${t.id}`} />}
                    {t.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                    {!!t.archivedAt && <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className={cn("text-base truncate block", t.unread ? "font-semibold" : "font-medium")}>{t.topic}</span>
                  </span>
                  <p className={cn("text-sm truncate mt-0.5", t.unread ? "text-foreground font-medium" : "text-muted-foreground")}>{t.lastMessage || "No messages yet"}</p>
                </button>
              ))
          )}
        </div>

        <div className="flex-1 min-w-0 hidden sm:flex">
          {selectedThread ? (
            <ThreadDetail thread={selectedThread} onSelectSurvivor={(id) => setPendingSelectId(id)} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a chat, or start a new one, to view messages
            </div>
          )}
        </div>

        {selectedThread && (
          <div className="sm:hidden fixed inset-0 z-20 bg-background flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <Button variant="ghost" size="sm" onClick={() => setSelectedThread(null)} data-testid="button-close-thread-mobile">
                Back
              </Button>
              <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                {selectedThread.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                {selectedThread.topic}
              </span>
            </div>
            <ThreadDetail thread={selectedThread} onSelectSurvivor={(id) => setPendingSelectId(id)} />
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadDetail({ thread, onSelectSurvivor }: { thread: ThreadRow; onSelectSurvivor: (id: number) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [referralDialogOpen, setReferralDialogOpen] = useState(false);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);

  // Same query/key the outer Chat list uses -- cache-shared, no extra request.
  const { data: allThreads } = useQuery<ThreadRow[]>({
    queryKey: ["/api/chat/threads"],
    refetchInterval: 5000,
  });

  const messagesKey = ["/api/chat/threads", thread.id, "messages"];
  const { data: messages, isLoading } = useQuery<ChatMessageWithMeta[]>({
    queryKey: messagesKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chat/threads/${thread.id}/messages`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: myReferrals } = useQuery<(Referral & { chatThreadId: number | null })[]>({
    queryKey: ["/api/referrals/mine"],
  });
  // Offer every one of the user's own referrals in the "link to existing
  // referral" dropdown -- including ones that already have their own chat
  // thread. Linking to an already-linked referral is exactly the scenario
  // that triggers the merge-confirmation flow in ReferralLinkPanel, so
  // filtering those out here would make merging unreachable from the UI.
  const unlinkedReferrals = myReferrals || [];

  // @-mention targets: this partner's own other chats, plus their own
  // referrals that don't have a dedicated thread yet. Picking a referral
  // or the always-available "start new chat" action creates the thread on
  // the fly via onCreateMentionTarget below.
  const mentionCandidates: MentionCandidate[] = [
    ...(allThreads || [])
      .filter((t) => t.id !== thread.id)
      .map((t): MentionCandidate => ({ type: "thread", id: t.id, label: threadMentionLabel(t), kind: t.kind as "general" | "referral" })),
    ...(myReferrals || [])
      .filter((r) => !r.chatThreadId)
      .map((r): MentionCandidate => ({ type: "referral", referralId: r.id, label: referralMentionLabel(r) })),
  ];

  const createMentionThreadMutation = useMutation({
    mutationFn: async ({ candidate, query }: { candidate: MentionCandidate; query: string }) => {
      const body = candidate.type === "referral" ? { referralId: candidate.referralId } : { topic: query.trim() || "New chat" };
      const res = await apiRequest("POST", "/api/chat/threads", body);
      return res.json() as Promise<ThreadRow>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
    },
  });

  async function resolvePartnerMention(candidate: MentionCandidate, query: string): Promise<{ id: number; label: string }> {
    const created = await createMentionThreadMutation.mutateAsync({ candidate, query });
    return { id: created.id, label: threadMentionLabel(created) };
  }

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string; replyToMessageId?: number }) =>
      apiRequest("POST", `/api/chat/threads/${thread.id}/messages`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  // Lookup map for rendering quoted-reply previews inside bubbles -- the
  // bubble itself only has its own message, not the full list.
  const messagesById = new Map((messages || []).map((m) => [m.id, m]));
  const replyingToMessage = replyingToId != null ? messagesById.get(replyingToId) : null;

  const flagMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/chat/messages/${id}/flag`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: number; emoji: string }) => apiRequest("PATCH", `/api/chat/messages/${id}/react`, { emoji }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const requestReactivationMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/chat/threads/${thread.id}/request-reactivation`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  const filteredMessages = (messages || []).filter((m) => {
    if (flaggedOnly && !m.flaggedByMe) return false;
    if (search.trim() && !m.body.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 border border-card-border rounded-lg bg-card p-4 gap-3">
      <div className="hidden sm:flex items-center gap-1.5 border-b border-border pb-2 -mt-1">
        {thread.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
        <span className="text-sm font-medium truncate">{thread.topic}</span>
      </div>

      {!!thread.archivedAt && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2" data-testid="banner-thread-archived">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Archive className="h-3.5 w-3.5 shrink-0" /> This chat has been archived.
          </span>
          {thread.reactivationRequestedAt ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary shrink-0" data-testid="text-reactivation-pending">
              <CheckCircle2 className="h-3.5 w-3.5" /> Reactivation requested
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 shrink-0"
              disabled={requestReactivationMutation.isPending}
              onClick={() => requestReactivationMutation.mutate()}
              data-testid="button-request-reactivation"
            >
              <Undo2 className="h-3.5 w-3.5" /> Request reactivation
            </Button>
          )}
        </div>
      )}

      <ReferralLinkPanel
        thread={thread}
        role={(user?.role as "partner" | "student") || "partner"}
        basePath="/api/chat"
        threadsQueryKey={["/api/chat/threads"]}
        unlinkedReferrals={unlinkedReferrals}
        onCreateReferralClick={() => setReferralDialogOpen(true)}
        onThreadChanged={(result) => {
          queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
          if (result?.survivingThreadId) onSelectSurvivor(result.survivingThreadId);
        }}
      />

      {(messages?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="h-8 pl-7 text-sm"
              data-testid="input-search-messages"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant={flaggedOnly ? "default" : "outline"}
            className="h-8 gap-1.5 shrink-0"
            onClick={() => setFlaggedOnly((v) => !v)}
            data-testid="button-toggle-flagged"
          >
            <Star className="h-3.5 w-3.5" /> Flagged
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3 min-h-0">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer self-start" />
            <Skeleton className="h-12 w-1/2 rounded-lg skeleton-shimmer self-end" />
          </>
        ) : !messages || messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm max-w-xs">No messages yet. Say hello — the MAHA team typically responds within one business day.</p>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <p className="text-sm">No messages match your search or filter.</p>
          </div>
        ) : (
          filteredMessages.map((m) => {
            const isMe = m.senderId === user?.id && m.senderRole === user?.role;
            const quotedSource = m.replyToMessageId != null ? messagesById.get(m.replyToMessageId) : null;
            return (
              <ChatMessageBubble
                key={m.id}
                message={m}
                isMe={isMe}
                onToggleFlag={(id) => flagMutation.mutate(id)}
                onReact={(id, emoji) => reactMutation.mutate({ id, emoji })}
                onNavigateToThread={onSelectSurvivor}
                onReply={(id) => setReplyingToId(id)}
                quoted={quotedSource ? { senderName: quotedSource.senderName, snippet: quotedSource.deletedAt ? "Message deleted" : (quotedSource.body || "Attachment") } : m.replyToMessageId ? { senderName: "", snippet: "Original message unavailable" } : null}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        key={thread.id}
        uploadUrl="/api/chat/upload"
        threadId={thread.id}
        onSend={(payload) => sendMutation.mutateAsync(payload)}
        sending={sendMutation.isPending}
        testIdPrefix="chat"
        mentionThreads={mentionCandidates}
        onResolveMention={resolvePartnerMention}
        replyingTo={replyingToMessage ? { id: replyingToMessage.id, senderName: replyingToMessage.senderName, snippet: replyingToMessage.deletedAt ? "Message deleted" : (replyingToMessage.body || "Attachment") } : null}
        onCancelReply={() => setReplyingToId(null)}
      />

      <ReferralFormDialog
        open={referralDialogOpen}
        onOpenChange={setReferralDialogOpen}
        linkThreadId={thread.id}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] })}
        // Already inside the linked thread (linkThreadId={thread.id}), so "open chat"
        // has nothing extra to navigate to here -- the referral posts into this thread.
      />
    </div>
  );
}
