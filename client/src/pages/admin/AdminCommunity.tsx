import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users2, MoreVertical, Archive, ArchiveRestore, Trash2, Eye, Ban, ShieldCheck, Pin, PinOff, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { CrossChatSearch } from "@/components/chat/CrossChatSearch";
import { TierBadge } from "@/components/TierBadge";
import type { CommunityTopic, CommunityMessage, CommunityMessageRead } from "@shared/schema";

interface TopicRow extends CommunityTopic {
  messageCount: number;
  lastMessagePreview: string;
  lastMessageSenderName: string | null;
  lastMessageSenderTierKey: string | null;
  lastMessageSenderTierLabel: string | null;
  unread: boolean;
}

// Same field-name adapter used on the member-facing Community page -- see
// that file's comment for why "topicId" needs to become "threadId" here.
function toBubbleMessage(m: CommunityMessage): ChatMessageWithMeta {
  return { ...m, threadId: m.topicId };
}

export default function AdminCommunity() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedTopic, setSelectedTopic] = useState<TopicRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTopicId, setDeleteTopicId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const { data: enabledData } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/community/enabled"] });

  const toggleEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PATCH", "/api/admin/community/enabled", { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/enabled"] });
      toast({ title: "Community settings updated" });
    },
    onError: (err: any) => toast({ title: "Could not update", description: err.message, variant: "destructive" }),
  });

  const { data: topics, isLoading } = useQuery<TopicRow[]>({
    queryKey: ["/api/community/topics", "includeArchived"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/community/topics?includeArchived=true");
      return res.json();
    },
    refetchInterval: 5000,
    enabled: !!enabledData?.enabled,
  });

  const archiveTopicMutation = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      apiRequest("PATCH", `/api/admin/community/topics/${id}/archive`, { archived }),
    onSuccess: (_data, { id, archived }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      toast({ title: archived ? "Topic archived" : "Topic unarchived" });
      if (archived && selectedTopic?.id === id) setSelectedTopic(null);
    },
    onError: (err: any) => toast({ title: "Could not update topic", description: err.message, variant: "destructive" }),
  });

  const deleteTopicMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/community/topics/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      setDeleteTopicId(null);
      toast({ title: "Topic deleted" });
      if (selectedTopic?.id === id) setSelectedTopic(null);
    },
    onError: (err: any) => toast({ title: "Could not delete topic", description: err.message, variant: "destructive" }),
  });

  const pinTopicMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) =>
      apiRequest("PATCH", `/api/admin/community/topics/${id}/pin`, { pinned }),
    onSuccess: (_data, { pinned }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      toast({ title: pinned ? "Topic pinned to top" : "Topic unpinned" });
    },
    onError: (err: any) => toast({ title: "Could not update topic", description: err.message, variant: "destructive" }),
  });

  const createTopicMutation = useMutation({
    mutationFn: (payload: { title: string; body?: string }) => apiRequest("POST", "/api/community/topics", payload),
    onSuccess: async (res) => {
      const data = await res.json();
      setNewTitle("");
      setNewBody("");
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      setSelectedTopic({
        ...data.topic,
        messageCount: data.firstMessage ? 1 : 0,
        lastMessagePreview: data.firstMessage?.body ?? "",
        lastMessageSenderName: data.firstMessage?.senderName ?? null,
        lastMessageSenderTierKey: null,
        lastMessageSenderTierLabel: null,
        unread: false,
      });
    },
    onError: (err: any) => toast({ title: "Could not create topic", description: err.message, variant: "destructive" }),
  });

  function handleCreateTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createTopicMutation.mutate({ title: newTitle.trim(), body: newBody.trim() });
  }

  function handleSelectSearchResult(topicId: number) {
    const found = topics?.find((t) => t.id === topicId);
    if (found) setSelectedTopic(found);
  }

  const activeTopics = (topics || []).filter((t) => !t.archivedAt);
  const archivedTopics = (topics || []).filter((t) => t.archivedAt);
  const visibleTopics = showArchived ? archivedTopics : activeTopics;

  useEffect(() => {
    if (!selectedTopic || !topics) return;
    const fresh = topics.find((t) => t.id === selectedTopic.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedTopic)) {
      setSelectedTopic(fresh);
    }
  }, [topics, selectedTopic]);

  if (enabledData && !enabledData.enabled) {
    return (
      <div className="flex flex-col h-[calc(100dvh-6.5rem)] max-w-5xl -m-1">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card p-4 mb-4">
          <div>
            <p className="text-sm font-medium">Community Chat is turned off</p>
            <p className="text-xs text-muted-foreground mt-0.5">Enable it to let partners and students see the Community tab and post topics.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label htmlFor="community-enabled-toggle" className="text-sm">Enabled</Label>
            <Switch
              id="community-enabled-toggle"
              checked={false}
              onCheckedChange={(v) => toggleEnabledMutation.mutate(v)}
              data-testid="switch-community-enabled"
            />
          </div>
        </div>
        <EmptyState icon={Users2} title="Community Chat is disabled" description="Turn it on above to start moderating topics." />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-6.5rem)] max-w-5xl -m-1">
      <div className="mb-3 flex items-center justify-between gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <CrossChatSearch searchUrl="/api/community/search" onSelectThread={handleSelectSearchResult} testIdPrefix="admin-community-search" label="Search all topics" />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="gap-1.5" data-testid="button-new-topic">
                <Plus className="h-4 w-4" /> New topic
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-new-topic">
              <DialogHeader>
                <DialogTitle>Start a Community topic</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateTopic} className="flex flex-col gap-3">
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Topic title, e.g. General"
                  data-testid="input-new-topic-title"
                  autoFocus
                />
                <Textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Optional opening message..."
                  rows={3}
                  data-testid="input-new-topic-body"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-new-topic">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!newTitle.trim() || createTopicMutation.isPending} data-testid="button-submit-new-topic">
                    Create topic
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="community-enabled-toggle" className="text-sm text-muted-foreground">Community enabled</Label>
          <Switch
            id="community-enabled-toggle"
            checked={!!enabledData?.enabled}
            onCheckedChange={(v) => toggleEnabledMutation.mutate(v)}
            data-testid="switch-community-enabled"
          />
        </div>
      </div>
      <div className="flex flex-1 min-h-0 gap-4">
        <div className="w-full sm:w-72 shrink-0 flex flex-col gap-2 overflow-y-auto overscroll-contain">
          <div className="flex items-center gap-1 rounded-lg border border-card-border bg-card p-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowArchived(false)}
              className={cn(
                "flex-1 rounded-md py-1 text-xs font-medium hover-elevate active-elevate-2",
                !showArchived ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              data-testid="button-tab-active-topics"
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setShowArchived(true)}
              className={cn(
                "flex-1 rounded-md py-1 text-xs font-medium hover-elevate active-elevate-2",
                showArchived ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              data-testid="button-tab-archived-topics"
            >
              Archived
            </button>
          </div>
          {isLoading ? (
            <>
              <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
              <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
            </>
          ) : !topics || topics.length === 0 ? (
            <EmptyState icon={Users2} title="No topics yet" description="Community topics will appear here once partners start posting." />
          ) : visibleTopics.length === 0 ? (
            <EmptyState
              icon={showArchived ? Archive : Users2}
              title={showArchived ? "No archived topics" : "No active topics"}
              description={showArchived ? "Topics you archive will show up here." : "Every topic is archived. Switch to the Archived tab to see them."}
            />
          ) : (
            visibleTopics
              .slice()
              .sort((a, b) => {
                if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
                if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt;
                return b.lastMessageAt - a.lastMessageAt;
              })
              .map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTopic(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedTopic(t);
                    }
                  }}
                  className={cn(
                    "text-left rounded-lg border p-3 hover-elevate active-elevate-2 cursor-pointer",
                    selectedTopic?.id === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card"
                  )}
                  data-testid={`button-topic-${t.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {!!t.pinnedAt && <Pin className="h-3 w-3 text-primary shrink-0" data-testid={`icon-pinned-topic-${t.id}`} />}
                      <span className="text-sm font-medium truncate">{t.title}</span>
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 -mr-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`button-topic-list-menu-${t.id}`}
                          aria-label="Topic options"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            pinTopicMutation.mutate({ id: t.id, pinned: !t.pinnedAt });
                          }}
                          data-testid={`menu-item-list-toggle-pin-${t.id}`}
                        >
                          {t.pinnedAt ? (
                            <>
                              <PinOff className="h-4 w-4 mr-2" /> Unpin topic
                            </>
                          ) : (
                            <>
                              <Pin className="h-4 w-4 mr-2" /> Pin topic to top
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveTopicMutation.mutate({ id: t.id, archived: !t.archivedAt });
                          }}
                          data-testid={`menu-item-list-toggle-archive-${t.id}`}
                        >
                          {t.archivedAt ? (
                            <>
                              <ArchiveRestore className="h-4 w-4 mr-2" /> Unarchive topic
                            </>
                          ) : (
                            <>
                              <Archive className="h-4 w-4 mr-2" /> Archive topic
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTopicId(t.id);
                          }}
                          className="text-destructive focus:text-destructive"
                          data-testid={`menu-item-list-delete-topic-${t.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete topic
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-xs truncate mt-0.5 text-muted-foreground flex items-center gap-1">
                    <span className="truncate min-w-0">
                      {t.lastMessageSenderName ? `${t.lastMessageSenderName}: ` : ""}
                      {t.lastMessagePreview || "No messages yet"}
                    </span>
                    <TierBadge tierKey={t.lastMessageSenderTierKey} tierLabel={t.lastMessageSenderTierLabel} className="shrink-0" />
                  </p>
                </div>
              ))
          )}
        </div>

        <div className="flex-1 min-w-0 hidden sm:flex">
          {selectedTopic ? (
            <TopicDetail topic={selectedTopic} onCloseTopic={() => setSelectedTopic(null)} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a topic to view messages
            </div>
          )}
        </div>

        {selectedTopic && (
          <div className="sm:hidden fixed inset-0 z-20 bg-background flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <Button variant="ghost" size="sm" onClick={() => setSelectedTopic(null)} data-testid="button-close-topic-mobile">Back</Button>
              <span className="text-sm font-medium truncate">{selectedTopic.title}</span>
            </div>
            <TopicDetail topic={selectedTopic} onCloseTopic={() => setSelectedTopic(null)} />
          </div>
        )}
      </div>

      <AlertDialog open={deleteTopicId !== null} onOpenChange={(open) => !open && setDeleteTopicId(null)}>
        <AlertDialogContent data-testid="dialog-delete-topic-list">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every message in this topic. Unlike archiving, this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-topic-list">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteTopicMutation.isPending}
              onClick={() => deleteTopicId !== null && deleteTopicMutation.mutate(deleteTopicId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-topic-list"
            >
              Delete topic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TopicDetail({ topic, onCloseTopic }: { topic: TopicRow; onCloseTopic: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [readsOpen, setReadsOpen] = useState(false);
  const [search, setSearch] = useState("");

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

  const { data: reads } = useQuery<CommunityMessageRead[]>({
    queryKey: ["/api/admin/community/topics", topic.id, "reads"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/community/topics/${topic.id}/reads`);
      return res.json();
    },
    enabled: readsOpen,
  });

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => apiRequest("PATCH", `/api/admin/community/topics/${topic.id}/archive`, { archived }),
    onSuccess: (_data, archived) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      toast({ title: archived ? "Topic archived" : "Topic unarchived" });
    },
    onError: (err: any) => toast({ title: "Could not update topic", description: err.message, variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: (pinned: boolean) => apiRequest("PATCH", `/api/admin/community/topics/${topic.id}/pin`, { pinned }),
    onSuccess: (_data, pinned) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      toast({ title: pinned ? "Topic pinned to top" : "Topic unpinned" });
    },
    onError: (err: any) => toast({ title: "Could not update topic", description: err.message, variant: "destructive" }),
  });

  const [deleteTopicOpen, setDeleteTopicOpen] = useState(false);
  const deleteTopicMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/community/topics/${topic.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
      setDeleteTopicOpen(false);
      toast({ title: "Topic deleted" });
      onCloseTopic();
    },
    onError: (err: any) => toast({ title: "Could not delete topic", description: err.message, variant: "destructive" }),
  });

  const [deleteMessageId, setDeleteMessageId] = useState<number | null>(null);
  const deleteMessageMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/community/messages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      setDeleteMessageId(null);
    },
    onError: (err: any) => toast({ title: "Could not delete message", description: err.message, variant: "destructive" }),
  });

  const [blockUserId, setBlockUserId] = useState<number | null>(null);
  const [blockUserName, setBlockUserName] = useState("");
  const blockUserMutation = useMutation({
    mutationFn: ({ id, blocked }: { id: number; blocked: boolean }) => apiRequest("POST", `/api/admin/community/users/${id}/block`, { blocked }),
    onSuccess: (_data, { blocked }) => {
      toast({ title: blocked ? "Member restricted from Community" : "Member restriction removed" });
      setBlockUserId(null);
    },
    onError: (err: any) => toast({ title: "Could not update member", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 border border-card-border rounded-lg bg-card p-4 gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {!!topic.pinnedAt && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
          <span className="text-sm font-medium truncate">{topic.title}</span>
          {!!topic.archivedAt && (
            <Badge variant="outline" className="text-xs shrink-0 no-default-hover-elevate no-default-active-elevate" data-testid="badge-topic-archived">
              Archived
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="button-topic-menu" aria-label="Topic options">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setReadsOpen(true)} data-testid="menu-item-view-reads">
              <Eye className="h-4 w-4 mr-2" /> View who's read this
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pinMutation.mutate(!topic.pinnedAt)} data-testid="menu-item-toggle-pin">
              {topic.pinnedAt ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" /> Unpin topic
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" /> Pin topic to top
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => archiveMutation.mutate(!topic.archivedAt)} data-testid="menu-item-toggle-archive">
              {topic.archivedAt ? (
                <>
                  <ArchiveRestore className="h-4 w-4 mr-2" /> Unarchive topic
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-2" /> Archive topic
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteTopicOpen(true)}
              className="text-destructive focus:text-destructive"
              data-testid="menu-item-delete-topic"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete topic
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(messages?.length ?? 0) > 0 && (
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="h-8 pl-7 text-xs"
            data-testid="input-search-community-messages"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3 min-h-0">
        {isLoading ? (
          <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer" />
        ) : !messages || messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No messages yet.</div>
        ) : (messages.filter((m) => !search.trim() || m.body.toLowerCase().includes(search.trim().toLowerCase()))).length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No messages match your search.</div>
        ) : (
          messages.filter((m) => !search.trim() || m.body.toLowerCase().includes(search.trim().toLowerCase())).map((m) => (
            <div key={m.id} className="group/msg relative pt-4">
              <ChatMessageBubble
                message={toBubbleMessage(m)}
                isMe={m.senderRole === "admin"}
                hideFlag
                hideReactions
                onToggleFlag={() => {}}
                onReact={() => {}}
                isAdmin
                onDelete={(id) => setDeleteMessageId(id)}
              />
              {!m.deletedAt && (
                <button
                  type="button"
                  onClick={() => {
                    setBlockUserId(m.senderId);
                    setBlockUserName(m.senderName);
                  }}
                  className={cn(
                    "absolute top-0 text-[10px] text-muted-foreground underline whitespace-nowrap opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto transition-opacity",
                    m.senderRole === "admin" ? "right-0" : "left-0"
                  )}
                  data-testid={`button-restrict-sender-${m.id}`}
                >
                  Restrict {m.senderName} from Community
                </button>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <p className="text-xs text-muted-foreground">
        Posting as an admin here is visible to every partner and student in this topic.
      </p>

      <AdminComposer topicId={topic.id} messagesKey={messagesKey} />

      <Dialog open={readsOpen} onOpenChange={setReadsOpen}>
        <DialogContent data-testid="dialog-topic-reads">
          <DialogHeader>
            <DialogTitle>Who's read this topic</DialogTitle>
          </DialogHeader>
          {!reads || reads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No read receipts yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
              {Array.from(new Map(reads.map((r) => [r.userId, r])).values())
                .sort((a, b) => b.readAt - a.readAt)
                .map((r) => (
                  <div key={r.userId} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                    <span>{r.userName}</span>
                    <span className="text-xs text-muted-foreground">{new Date(r.readAt).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteMessageId !== null} onOpenChange={(open) => !open && setDeleteMessageId(null)}>
        <DialogContent data-testid="dialog-delete-message">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The message will be replaced with "This message was deleted" for everyone in this topic. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteMessageId(null)} data-testid="button-cancel-delete-message">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMessageMutation.isPending}
              onClick={() => deleteMessageId !== null && deleteMessageMutation.mutate(deleteMessageId)}
              data-testid="button-confirm-delete-message"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!blockUserId} onOpenChange={(open) => !open && setBlockUserId(null)}>
        <AlertDialogContent data-testid="dialog-restrict-user">
          <AlertDialogHeader>
            <AlertDialogTitle>Restrict {blockUserName} from Community?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll no longer be able to view or post in Community topics until you lift the restriction.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-restrict-user">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={blockUserMutation.isPending}
              onClick={() => blockUserId !== null && blockUserMutation.mutate({ id: blockUserId, blocked: true })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-restrict-user"
            >
              <Ban className="h-4 w-4 mr-2" /> Restrict
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Thin wrapper so the admin composer's send mutation lives close to its
// ChatComposer instance without duplicating the whole TopicDetail body.
function AdminComposer({ topicId, messagesKey }: { topicId: number; messagesKey: unknown[] }) {
  const queryClient = useQueryClient();
  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string }) =>
      apiRequest("POST", `/api/community/topics/${topicId}/messages`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["/api/community/topics", "includeArchived"] });
    },
  });

  return (
    <ChatComposer
      key={topicId}
      uploadUrl="/api/community/upload"
      threadId={topicId}
      onSend={(payload) => sendMutation.mutateAsync(payload)}
      sending={sendMutation.isPending}
      testIdPrefix="admin-community"
      placeholder="Type a message..."
    />
  );
}
