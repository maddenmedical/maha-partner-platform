import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Users2, Plus, Info, MessagesSquare, Globe2, Handshake, TrendingUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { UserAvatar } from "@/components/UserAvatar";
import { TierBadge } from "@/components/TierBadge";
import type { CommunityTopic, CommunityMessage } from "@shared/schema";

// Adapts a community message onto the shared ChatMessageBubble's expected
// shape. communityMessages and chatMessages are identical except the
// community table calls its parent-thread column "topicId" instead of
// "threadId" -- everything else lines up field-for-field.
function toBubbleMessage(m: CommunityMessage): ChatMessageWithMeta {
  return { ...m, threadId: m.topicId };
}

interface TopicRow extends CommunityTopic {
  messageCount: number;
  lastMessagePreview: string;
  lastMessageSenderName: string | null;
  lastMessageSenderTierKey: string | null;
  lastMessageSenderTierLabel: string | null;
  unread: boolean;
}

const PURPOSE_BANNER =
  "This is where MAHA partners from around the world come together — to talk through real cases, share the techniques and philosophies that work in their hands, and see how others approach the same problem differently. It's also where the relationships that turn into referrals and lasting friendships get started.";

const PURPOSE_BULLETS = [
  { icon: MessagesSquare, title: "Brainstorm real cases", body: "Post a tricky one and get perspectives from clinicians who've seen it before." },
  { icon: Globe2, title: "Learn how the world does it", body: "Every country and training background brings a different approach. See what you'd never see inside your own practice." },
  { icon: Handshake, title: "Build your network", body: "The partners you meet here become referral partners, co-speakers, and collaborators." },
  { icon: TrendingUp, title: "Talk about where the field is going", body: "New techniques, new materials, new ways of running a practice." },
];

export default function Community() {
  const queryClient = useQueryClient();
  const [selectedTopic, setSelectedTopic] = useState<TopicRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const { data: enabledData, isLoading: enabledLoading } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/community/enabled"] });

  const { data: topics, isLoading } = useQuery<TopicRow[]>({
    queryKey: ["/api/community/topics"],
    refetchInterval: 5000,
    enabled: !!enabledData?.enabled,
  });

  const createTopicMutation = useMutation({
    mutationFn: (payload: { title: string; body?: string }) => apiRequest("POST", "/api/community/topics", payload),
    onSuccess: async (res) => {
      const data = await res.json();
      setNewTitle("");
      setNewBody("");
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/community/topics"] });
      setSelectedTopic({ ...data.topic, messageCount: data.firstMessage ? 1 : 0, lastMessagePreview: data.firstMessage?.body ?? "", lastMessageSenderName: data.firstMessage?.senderName ?? null, unread: false });
    },
  });

  useEffect(() => {
    if (!selectedTopic || !topics) return;
    const fresh = topics.find((t) => t.id === selectedTopic.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedTopic)) {
      setSelectedTopic(fresh);
    }
  }, [topics, selectedTopic]);

  function handleCreateTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createTopicMutation.mutate({ title: newTitle.trim(), body: newBody.trim() });
  }

  // "General" always pinned at top -- there's no schema flag for it, so we
  // sort by an exact title match first, then most-recently-active.
  const sortedTopics = (topics || [])
    .slice()
    .sort((a, b) => {
      const aGeneral = a.title.trim().toLowerCase() === "general";
      const bGeneral = b.title.trim().toLowerCase() === "general";
      if (aGeneral !== bGeneral) return aGeneral ? -1 : 1;
      return b.lastMessageAt - a.lastMessageAt;
    });

  if (!enabledLoading && enabledData && !enabledData.enabled) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <EmptyState icon={Users2} title="Community isn't open yet" description="Check back soon — MAHA is preparing this space for partners." />
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-9.5rem)] max-w-5xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-community-title">
              Community
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover-elevate active-elevate-2 rounded-full p-0.5"
                    aria-label="What's this for?"
                    data-testid="button-community-info"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80" data-testid="popover-community-info">
                  <p className="text-sm text-muted-foreground mb-3">{PURPOSE_BANNER}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">What's this for?</p>
                  <div className="flex flex-col gap-2.5">
                    {PURPOSE_BULLETS.map((b) => (
                      <div key={b.title} className="flex items-start gap-2">
                        <b.icon className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <span>
                          <span className="text-sm font-medium block">{b.title}</span>
                          <span className="text-xs text-muted-foreground">{b.body}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Your global network of MAHA partners.</p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 shrink-0" data-testid="button-new-topic">
              <Plus className="h-4 w-4" /> New topic
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start a new topic</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateTopic} className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block" htmlFor="topic-title-input">
                  Title
                </label>
                <Input
                  id="topic-title-input"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Anterior open bite management"
                  autoFocus
                  data-testid="input-topic-title"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block" htmlFor="topic-body-input">
                  First message (optional)
                </label>
                <Textarea
                  id="topic-body-input"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Kick off the discussion..."
                  rows={4}
                  data-testid="textarea-topic-body"
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createTopicMutation.isPending || !newTitle.trim()} data-testid="button-create-topic">
                  {createTopicMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start topic"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-1 min-h-0 gap-4">
        <div className="w-full sm:w-72 shrink-0 flex flex-col gap-2 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <>
              <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
              <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
            </>
          ) : sortedTopics.length === 0 ? (
            <EmptyState icon={Users2} title="No topics yet" description="Start the first Community topic above." />
          ) : (
            sortedTopics.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTopic(t)}
                className={cn(
                  "text-left rounded-lg border p-3 hover-elevate active-elevate-2",
                  selectedTopic?.id === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card"
                )}
                data-testid={`button-topic-${t.id}`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {t.unread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-topic-${t.id}`} />}
                  <span className={cn("text-sm truncate block", t.unread ? "font-semibold" : "font-medium")}>{t.title}</span>
                </span>
                <p className={cn("text-xs truncate mt-0.5 flex items-center gap-1", t.unread ? "text-foreground font-medium" : "text-muted-foreground")}>
                  <span className="truncate min-w-0">
                    {t.lastMessageSenderName ? `${t.lastMessageSenderName}: ` : ""}
                    {t.lastMessagePreview || "No messages yet"}
                  </span>
                  <TierBadge tierKey={t.lastMessageSenderTierKey} tierLabel={t.lastMessageSenderTierLabel} className="shrink-0" />
                </p>
              </button>
            ))
          )}
        </div>

        <div className="flex-1 min-w-0 hidden sm:flex">
          {selectedTopic ? (
            <TopicDetail topic={selectedTopic} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a topic, or start a new one, to view messages
            </div>
          )}
        </div>

        {selectedTopic && (
          <div className="sm:hidden fixed inset-0 z-20 bg-background flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <Button variant="ghost" size="sm" onClick={() => setSelectedTopic(null)} data-testid="button-close-topic-mobile">
                Back
              </Button>
              <span className="text-sm font-medium truncate">{selectedTopic.title}</span>
            </div>
            <TopicDetail topic={selectedTopic} />
          </div>
        )}
      </div>
    </div>
  );
}

function TopicDetail({ topic }: { topic: TopicRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesKey = ["/api/community/topics", topic.id, "messages"];
  const { data, isLoading } = useQuery<{ topic: CommunityTopic; messages: CommunityMessage[] }>({
    queryKey: messagesKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/community/topics/${topic.id}/messages`);
      return res.json();
    },
    refetchInterval: 5000,
  });
  const messages = data?.messages;

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string; replyToMessageId?: number }) =>
      apiRequest("POST", `/api/community/topics/${topic.id}/messages`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 border border-card-border rounded-lg bg-card p-4 gap-3">
      <div className="hidden sm:flex items-center gap-1.5 border-b border-border pb-2 -mt-1">
        <span className="text-sm font-medium truncate">{topic.title}</span>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3 min-h-0">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer self-start" />
            <Skeleton className="h-12 w-1/2 rounded-lg skeleton-shimmer self-end" />
          </>
        ) : !messages || messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <Users2 className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm max-w-xs">No messages yet. Be the first to post in this topic.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === user?.id && m.senderRole === user?.role;
            return (
              <ChatMessageBubble
                key={m.id}
                message={toBubbleMessage(m)}
                isMe={isMe}
                hideFlag
                hideReactions
                onToggleFlag={() => {}}
                onReact={() => {}}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        key={topic.id}
        uploadUrl="/api/community/upload"
        threadId={topic.id}
        onSend={(payload) => sendMutation.mutateAsync(payload)}
        sending={sendMutation.isPending}
        testIdPrefix="community"
        placeholder="Type a message..."
      />
    </div>
  );
}
