import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Stethoscope, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { consumePendingThreadId } from "@/lib/chatNav";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { ReferralLinkPanel } from "@/components/chat/ReferralLinkPanel";
import { CrossChatSearch } from "@/components/chat/CrossChatSearch";
import type { Referral } from "@shared/schema";

interface ThreadRow {
  id: number;
  userId: number;
  userRole: "partner" | "student";
  topic?: string;
  userName?: string;
  userEmail?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  messageCount: number;
  kind: "general" | "referral";
  referralId: number | null;
  pendingReferralRequestedAt: number | null;
  pendingReferralRequestedByRole: "partner" | "student" | "admin" | null;
  createdAt: number;
}

interface AdminReferralRow extends Referral {
  partnerId: number;
  chatThreadId: number | null;
}

export default function AdminChatInbox() {
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(() => consumePendingThreadId());

  const { data: threads, isLoading } = useQuery<ThreadRow[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!selectedThread || !threads) return;
    const fresh = threads.find((t) => t.id === selectedThread.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedThread)) {
      setSelectedThread(fresh);
    }
  }, [threads, selectedThread]);

  useEffect(() => {
    if (!pendingSelectId || !threads) return;
    const target = threads.find((t) => t.id === pendingSelectId);
    if (target) {
      setSelectedThread(target);
      setPendingSelectId(null);
    }
  }, [pendingSelectId, threads]);

  return (
    <div className="flex flex-col h-[calc(100dvh-6.5rem)] max-w-5xl -m-1">
      <div className="mb-3 flex justify-end shrink-0">
        <CrossChatSearch searchUrl="/api/admin/chat/search" onSelectThread={(id) => setPendingSelectId(id)} testIdPrefix="admin-chat-search" />
      </div>
      <div className="flex flex-1 min-h-0 gap-4">
      <div className="w-full sm:w-72 shrink-0 flex flex-col gap-2 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <>
            <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
          </>
        ) : !threads || threads.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No conversations" description="Partner and student messages will appear here." />
        ) : (
          threads.map((t) => (
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
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  {t.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span className="text-sm font-medium truncate">{t.userName}</span>
                </span>
                <Badge variant="outline" className="text-xs capitalize no-default-hover-elevate no-default-active-elevate shrink-0">{t.userRole}</Badge>
              </div>
              {t.topic && <span className="text-xs text-primary font-medium truncate block mt-0.5">{t.topic}</span>}
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
            Select a conversation to view messages
          </div>
        )}
      </div>

      {selectedThread && (
        <div className="sm:hidden fixed inset-0 z-20 bg-background flex flex-col">
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <Button variant="ghost" size="sm" onClick={() => setSelectedThread(null)} data-testid="button-close-thread-mobile">Back</Button>
            <span className="flex items-center gap-1.5 text-sm font-medium truncate">
              {selectedThread.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
              {selectedThread.userName}
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
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const messagesKey = ["/api/admin/chat/threads", thread.id, "messages"];
  const { data: messages, isLoading } = useQuery<ChatMessageWithMeta[]>({
    queryKey: messagesKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/chat/threads/${thread.id}/messages`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: allReferrals } = useQuery<AdminReferralRow[]>({ queryKey: ["/api/admin/referrals"] });
  const unlinkedReferrals = (allReferrals || []).filter((r) => r.partnerId === thread.userId && !r.chatThreadId);

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string }) =>
      apiRequest("POST", `/api/admin/chat/threads/${thread.id}/messages`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
    },
  });

  const flagMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/admin/chat/messages/${id}/flag`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: number; emoji: string }) => apiRequest("PATCH", `/api/admin/chat/messages/${id}/react`, { emoji }),
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
      <ReferralLinkPanel
        thread={thread}
        role="admin"
        basePath="/api/admin/chat"
        threadsQueryKey={["/api/admin/chat/threads"]}
        unlinkedReferrals={unlinkedReferrals.map((r) => ({ id: r.id, patientFirstName: r.patientFirstName, patientLastName: r.patientLastName }))}
        onCreateReferralClick={() => {}}
        onThreadChanged={(result) => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] });
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
          <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer" />
        ) : !messages || messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No messages yet.</div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No messages match your search or filter.</div>
        ) : (
          filteredMessages.map((m) => (
            <ChatMessageBubble
              key={m.id}
              message={m}
              isMe={m.senderRole === "admin"}
              onToggleFlag={(id) => flagMutation.mutate(id)}
              onReact={(id, emoji) => reactMutation.mutate({ id, emoji })}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        uploadUrl="/api/admin/chat/upload"
        threadId={thread.id}
        onSend={(payload) => sendMutation.mutateAsync(payload)}
        sending={sendMutation.isPending}
        testIdPrefix="admin-chat"
      />
    </div>
  );
}
