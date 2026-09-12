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
import { MessageSquare, Loader2, Plus, Stethoscope, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { consumePendingThreadId } from "@/lib/chatNav";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { ReferralLinkPanel } from "@/components/chat/ReferralLinkPanel";
import { ReferralFormDialog } from "@/components/chat/ReferralFormDialog";
import { CrossChatSearch } from "@/components/chat/CrossChatSearch";
import type { ChatThread, Referral } from "@shared/schema";

interface ThreadRow extends ChatThread {
  lastMessage?: string;
  lastMessageAt?: number;
  messageCount: number;
}

export default function Chat({ label = "Chat with MAHA Team" }: { label?: string }) {
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(() => consumePendingThreadId());
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [topic, setTopic] = useState("");

  const { data: threads, isLoading } = useQuery<ThreadRow[]>({
    queryKey: ["/api/chat/threads"],
    refetchInterval: 5000,
  });

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
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <CrossChatSearch searchUrl="/api/chat/search" onSelectThread={(id) => setPendingSelectId(id)} testIdPrefix="chat-search" />
        <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 shrink-0" data-testid="button-new-chat">
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </DialogTrigger>
          <DialogContent>
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
              <DialogFooter>
                <Button type="submit" disabled={createThread.isPending || !topic.trim()} data-testid="button-create-chat">
                  {createThread.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start chat"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

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
                    {t.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                    <span className="text-sm font-medium truncate block">{t.topic}</span>
                  </span>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{t.lastMessage || "No messages yet"}</p>
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

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string }) =>
      apiRequest("POST", `/api/chat/threads/${thread.id}/messages`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const flagMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/chat/messages/${id}/flag`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: number; emoji: string }) => apiRequest("PATCH", `/api/chat/messages/${id}/react`, { emoji }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
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
              className="h-8 pl-7 text-xs"
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
            return (
              <ChatMessageBubble
                key={m.id}
                message={m}
                isMe={isMe}
                onToggleFlag={(id) => flagMutation.mutate(id)}
                onReact={(id, emoji) => reactMutation.mutate({ id, emoji })}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        uploadUrl="/api/chat/upload"
        threadId={thread.id}
        onSend={(payload) => sendMutation.mutateAsync(payload)}
        sending={sendMutation.isPending}
        testIdPrefix="chat"
      />

      <ReferralFormDialog
        open={referralDialogOpen}
        onOpenChange={setReferralDialogOpen}
        linkThreadId={thread.id}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] })}
      />
    </div>
  );
}
