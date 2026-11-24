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
import { Users2, Plus, Info, MessagesSquare, Globe2, Handshake, TrendingUp, Loader2, Search, Pin, Video, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { CrossChatSearch } from "@/components/chat/CrossChatSearch";
import { UserAvatar } from "@/components/UserAvatar";
import { TierBadge } from "@/components/TierBadge";
import { ChatCommunitySwitcher } from "@/components/ChatCommunitySwitcher";
import { WelcomeIntroModal } from "@/components/community/WelcomeIntroModal";
import type { CommunityTopic, CommunityMessage } from "@shared/schema";

// Adapts a community message onto the shared ChatMessageBubble's expected
// shape. communityMessages and chatMessages are identical except the
// community table calls its parent-thread column "topicId" instead of
// "threadId" -- everything else lines up field-for-field.
type EnrichedCommunityMessage = CommunityMessage & { attachmentThumbnail?: string | null; attachmentProcessing?: boolean };

function toBubbleMessage(m: EnrichedCommunityMessage): ChatMessageWithMeta {
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTopic, setSelectedTopic] = useState<TopicRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  // ---- Welcome/intro flow: fully skippable, reminded every 5th visit (up
  // to 3 times), plus a persistent manual entry point until posted. Only
  // for partners/students -- admins aren't "new members" being welcomed. ----
  const isNewMemberRole = user?.role === "partner" || user?.role === "student";
  const [introDone, setIntroDone] = useState(false);
  const [introBannerOpen, setIntroBannerOpen] = useState(false);
  const [introModalOpen, setIntroModalOpen] = useState(false);
  const introVisitFired = useRef(false);

  const introVisitMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/community/welcome-intro/visit").then((r) => r.json()),
    onSuccess: (data: { welcomeIntroPostedAt: number | null; shouldShowReminder: boolean }) => {
      setIntroDone(!!data.welcomeIntroPostedAt);
      if (data.shouldShowReminder) setIntroBannerOpen(true);
    },
  });

  const { data: enabledData, isLoading: enabledLoading } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/community/enabled"] });

  useEffect(() => {
    if (!isNewMemberRole || !enabledData?.enabled || introVisitFired.current) return;
    introVisitFired.current = true;
    introVisitMutation.mutate();
  }, [isNewMemberRole, enabledData?.enabled]);

  const { data: topics, isLoading } = useQuery<TopicRow[]>({
    queryKey: ["/api/community/topics"],
    refetchInterval: 5000,
    enabled: !!enabledData?.enabled,
  });

  // Same query/key MobileAppLayout already polls for the tab-bar dot --
  // shared cache, no extra request -- so the switcher can show a dot for
  // Inbox even while sitting on this page.
  const { data: chatThreads } = useQuery<{ unread?: boolean }[]>({
    queryKey: ["/api/chat/threads"],
    refetchInterval: 5000,
  });
  const hasUnreadInbox = !!chatThreads?.some((t) => t.unread);
  const hasUnreadCommunity = !!topics?.some((t) => t.unread);

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

  // Admin-pinned topics (e.g. "General") always float to the top,
  // most-recently-pinned first; everything else sorts by recent activity.
  const sortedTopics = (topics || [])
    .slice()
    .sort((a, b) => {
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt;
      return b.lastMessageAt - a.lastMessageAt;
    });

  function handleSelectSearchResult(topicId: number) {
    const found = topics?.find((t) => t.id === topicId);
    if (found) setSelectedTopic(found);
  }

  if (!enabledLoading && enabledData && !enabledData.enabled) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <div className="mb-4">
          <ChatCommunitySwitcher active="community" hasUnreadInbox={hasUnreadInbox} hasUnreadCommunity={false} />
        </div>
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
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <ChatCommunitySwitcher active="community" hasUnreadInbox={hasUnreadInbox} hasUnreadCommunity={hasUnreadCommunity} />
              <CrossChatSearch searchUrl="/api/community/search" onSelectThread={handleSelectSearchResult} testIdPrefix="community-search" label="Search all topics" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isNewMemberRole && !introDone && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setIntroModalOpen(true)}
              data-testid="button-welcome-intro-entry"
            >
              <Video className="h-4 w-4" /> Introduce yourself
            </Button>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" data-testid="button-new-topic">
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
      </div>

      {introBannerOpen && isNewMemberRole && !introDone && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3 flex-wrap" data-testid="banner-welcome-intro">
          <div className="flex items-center gap-2 min-w-0">
            <PartyPopper className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm min-w-0">
              <span className="font-medium">Say hello to the community!</span>{" "}
              <span className="text-muted-foreground">Post a short intro video so other partners get to know you.</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => setIntroBannerOpen(false)} data-testid="button-welcome-intro-dismiss">
              Maybe later
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setIntroBannerOpen(false);
                setIntroModalOpen(true);
              }}
              data-testid="button-welcome-intro-accept"
            >
              Introduce yourself
            </Button>
          </div>
        </div>
      )}

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
                  {!!t.pinnedAt && <Pin className="h-3 w-3 text-primary shrink-0" data-testid={`icon-pinned-topic-${t.id}`} />}
                  {t.unread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-topic-${t.id}`} />}
                  <span className={cn("text-base truncate block", t.unread ? "font-semibold" : "font-medium")}>{t.title}</span>
                </span>
                <p className={cn("text-sm truncate mt-0.5 flex items-center gap-1", t.unread ? "text-foreground font-medium" : "text-muted-foreground")}>
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

      {isNewMemberRole && (
        <WelcomeIntroModal
          open={introModalOpen}
          onOpenChange={setIntroModalOpen}
          onPosted={() => {
            setIntroDone(true);
            setIntroBannerOpen(false);
            queryClient.invalidateQueries({ queryKey: ["/api/community/topics"] });
          }}
        />
      )}
    </div>
  );
}

function TopicDetail({ topic }: { topic: TopicRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  const messagesKey = ["/api/community/topics", topic.id, "messages"];
  const { data, isLoading } = useQuery<{ topic: CommunityTopic; messages: EnrichedCommunityMessage[] }>({
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

  const filteredMessages = (messages || []).filter((m) => {
    if (search.trim() && !m.body.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 border border-card-border rounded-lg bg-card p-4 gap-3">
      <div className="hidden sm:flex items-center gap-1.5 border-b border-border pb-2 -mt-1">
        {!!topic.pinnedAt && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
        <span className="text-sm font-medium truncate">{topic.title}</span>
      </div>

      {(messages?.length ?? 0) > 0 && (
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="h-8 pl-7 text-sm"
            data-testid="input-search-community-messages"
          />
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
            <Users2 className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm max-w-xs">No messages yet. Be the first to post in this topic.</p>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <p className="text-sm">No messages match your search.</p>
          </div>
        ) : (
          filteredMessages.map((m) => {
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
