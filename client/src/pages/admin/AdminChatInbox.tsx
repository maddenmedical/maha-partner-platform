import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { MessageSquare, Stethoscope, Search, Star, MoreVertical, Archive, ArchiveRestore, Trash2, Undo2, Users, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { consumePendingThreadId } from "@/lib/chatNav";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble, type ChatMessageWithMeta } from "@/components/chat/ChatMessageBubble";
import { UserAvatar } from "@/components/UserAvatar";
import { ReferralLinkPanel } from "@/components/chat/ReferralLinkPanel";
import { CrossChatSearch } from "@/components/chat/CrossChatSearch";
import { threadMentionLabel, referralMentionLabel, type MentionCandidate } from "@/lib/chatMentions";
import type { Referral, User } from "@shared/schema";

interface ThreadRow {
  id: number;
  userId: number;
  userRole: "partner" | "student";
  topic?: string;
  userName?: string;
  userEmail?: string;
  userPhotoUrl?: string | null;
  lastMessage?: string;
  lastMessageAt?: number;
  messageCount: number;
  kind: "general" | "referral";
  referralId: number | null;
  pendingReferralRequestedAt: number | null;
  pendingReferralRequestedByRole: "partner" | "student" | "admin" | null;
  createdAt: number;
  unread?: boolean;
  archivedAt?: number | null;
  reactivationRequestedAt?: number | null;
}

interface AdminReferralRow extends Referral {
  partnerId: number;
  chatThreadId: number | null;
}

export default function AdminChatInbox() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(() => consumePendingThreadId());
  const [view, setView] = useState<"active" | "archived" | "team">("active");
  const [deleteThreadId, setDeleteThreadId] = useState<number | null>(null);
  const [staffSelection, setStaffSelection] = useState<StaffSelection>(null);

  const { data: threads, isLoading } = useQuery<ThreadRow[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 5000,
  });

  const archiveThreadMutation = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      apiRequest("PATCH", `/api/admin/chat/threads/${id}/archive`, { archived }),
    onSuccess: (_data, { id, archived }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      toast({ title: archived ? "Chat archived" : "Chat unarchived" });
      if (archived && selectedThread?.id === id) setSelectedThread(null);
    },
    onError: (err: any) => toast({ title: "Could not update chat", description: err.message, variant: "destructive" }),
  });

  const deleteThreadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/chat/threads/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setDeleteThreadId(null);
      toast({ title: "Chat deleted" });
      if (selectedThread?.id === id) setSelectedThread(null);
    },
    onError: (err: any) => toast({ title: "Could not delete chat", description: err.message, variant: "destructive" }),
  });

  const activeThreads = (threads || []).filter((t) => !t.archivedAt);
  const archivedThreads = (threads || []).filter((t) => t.archivedAt);
  const visibleThreads = view === "archived" ? archivedThreads : activeThreads;
  const reactivationRequestCount = archivedThreads.filter((t) => t.reactivationRequestedAt).length;

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
        <div className="flex items-center gap-1 rounded-lg border border-card-border bg-card p-1 shrink-0">
          <button
            type="button"
            onClick={() => setView("active")}
            className={cn(
              "flex-1 rounded-md py-1 text-xs font-medium hover-elevate active-elevate-2",
              view === "active" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
            data-testid="button-tab-active-chats"
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setView("archived")}
            className={cn(
              "flex-1 rounded-md py-1 text-xs font-medium hover-elevate active-elevate-2 flex items-center justify-center gap-1.5",
              view === "archived" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
            data-testid="button-tab-archived-chats"
          >
            Archived
            {reactivationRequestCount > 0 && (
              <Badge className="h-4 min-w-4 px-1 text-[10px] leading-none no-default-hover-elevate no-default-active-elevate" data-testid="badge-reactivation-requests">
                {reactivationRequestCount}
              </Badge>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setView("team"); setSelectedThread(null); }}
            className={cn(
              "flex-1 rounded-md py-1 text-xs font-medium hover-elevate active-elevate-2 flex items-center justify-center gap-1.5",
              view === "team" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
            data-testid="button-tab-team-chat"
          >
            <Users className="h-3.5 w-3.5" /> Team
          </button>
        </div>
        {view === "team" ? (
          <StaffChatSidebar onSelect={setStaffSelection} selected={staffSelection} />
        ) : isLoading ? (
          <>
            <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
          </>
        ) : !threads || threads.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No conversations" description="Partner and student messages will appear here." />
        ) : visibleThreads.length === 0 ? (
          <EmptyState
            icon={view === "archived" ? Archive : MessageSquare}
            title={view === "archived" ? "No archived chats" : "No active chats"}
            description={view === "archived" ? "Chats you archive will show up here." : "Every chat is archived. Switch to the Archived tab to see them."}
          />
        ) : (
          visibleThreads
            .slice()
            .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt))
            .map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedThread(t)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedThread(t);
                }
              }}
              className={cn(
                "text-left rounded-lg border p-3 hover-elevate active-elevate-2 cursor-pointer",
                selectedThread?.id === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card",
                t.kind === "referral" && selectedThread?.id !== t.id && "border-l-2 border-l-primary"
              )}
              data-testid={`button-thread-${t.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <UserAvatar photoUrl={t.userPhotoUrl} name={t.userName || "?"} size="sm" className="shrink-0" />
                  <span className="flex items-center gap-1.5 min-w-0">
                    {t.unread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-thread-${t.id}`} />}
                    {t.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                    <span className={cn("text-base truncate", t.unread ? "font-semibold" : "font-medium")}>{t.userName}</span>
                  </span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className="text-xs capitalize no-default-hover-elevate no-default-active-elevate shrink-0">{t.userRole}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 -mr-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`button-thread-list-menu-${t.id}`}
                        aria-label="Chat options"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          archiveThreadMutation.mutate({ id: t.id, archived: !t.archivedAt });
                        }}
                        data-testid={`menu-item-list-toggle-archive-${t.id}`}
                      >
                        {t.archivedAt ? (
                          <>
                            <ArchiveRestore className="h-4 w-4 mr-2" /> Unarchive chat
                          </>
                        ) : (
                          <>
                            <Archive className="h-4 w-4 mr-2" /> Archive chat
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteThreadId(t.id);
                        }}
                        className="text-destructive focus:text-destructive"
                        data-testid={`menu-item-list-delete-thread-${t.id}`}
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Delete chat
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
              {t.topic && <span className="text-sm text-primary font-medium truncate block mt-0.5 ml-8">{t.topic}</span>}
              <p className={cn("text-sm truncate mt-0.5 ml-8", t.unread ? "text-foreground font-medium" : "text-muted-foreground")}>{t.lastMessage || "No messages yet"}</p>
              {t.archivedAt && t.reactivationRequestedAt && (
                <span className="mt-1 ml-8 flex items-center gap-1 text-xs font-medium text-primary" data-testid={`badge-reactivation-requested-${t.id}`}>
                  <Undo2 className="h-3 w-3" /> Reopen requested
                </span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex-1 min-w-0 hidden sm:flex">
        {view === "team" ? (
          staffSelection ? (
            <StaffChatDetail selection={staffSelection} onClose={() => setStaffSelection(null)} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select the Staff Room or a teammate to chat with
            </div>
          )
        ) : selectedThread ? (
          <ThreadDetail thread={selectedThread} allThreads={threads} onSelectSurvivor={(id) => setPendingSelectId(id)} onCloseThread={() => setSelectedThread(null)} />
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
            <span className="flex items-center gap-2 text-sm font-medium truncate">
              <UserAvatar photoUrl={selectedThread.userPhotoUrl} name={selectedThread.userName || "?"} size="sm" />
              <span className="flex items-center gap-1.5 min-w-0">
                {selectedThread.kind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                <span className="truncate">{selectedThread.userName}</span>
              </span>
            </span>
          </div>
          <ThreadDetail thread={selectedThread} allThreads={threads} onSelectSurvivor={(id) => setPendingSelectId(id)} onCloseThread={() => setSelectedThread(null)} />
        </div>
      )}

      {view === "team" && staffSelection && (
        <div className="sm:hidden fixed inset-0 z-20 bg-background flex flex-col">
          <StaffChatDetail selection={staffSelection} onClose={() => setStaffSelection(null)} showBackButton />
        </div>
      )}
      </div>

      <AlertDialog open={deleteThreadId !== null} onOpenChange={(open) => !open && setDeleteThreadId(null)}>
        <AlertDialogContent data-testid="dialog-delete-thread-list">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every message in this chat, along with any linked to-dos. Unlike archiving, this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-thread-list">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteThreadMutation.isPending}
              onClick={() => deleteThreadId !== null && deleteThreadMutation.mutate(deleteThreadId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-thread-list"
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ThreadDetail({ thread, allThreads, onSelectSurvivor, onCloseThread }: { thread: ThreadRow; allThreads?: ThreadRow[]; onSelectSurvivor: (id: number) => void; onCloseThread: () => void }) {
  const queryClient = useQueryClient();
  // Same partner's other chats -- @-mentioning one drops in a jump link so
  // an admin can hand a conversation about a different patient over to its
  // own thread instead of letting it drift off-topic in this one.
  const mentionThreads: MentionCandidate[] = (allThreads || [])
    .filter((t) => t.userId === thread.userId && t.id !== thread.id)
    .map((t): MentionCandidate => ({ type: "thread", id: t.id, label: threadMentionLabel(t), kind: t.kind }));
  const bottomRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);

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
  // Offer every referral belonging to this chat's owner -- including ones
  // that already have their own chat thread. Linking to an already-linked
  // referral is exactly the scenario that triggers the merge-confirmation
  // flow in ReferralLinkPanel, so filtering those out here would make
  // merging unreachable from the admin UI.
  const unlinkedReferrals = (allReferrals || []).filter((r) => r.partnerId === thread.userId);
  // Referrals for this partner with no dedicated thread yet -- these are
  // exactly the ones worth offering as "@" mention targets, since picking
  // an already-linked referral would just duplicate its existing thread
  // (which is already reachable directly from mentionThreads above).
  const referralMentionCandidates: MentionCandidate[] = (allReferrals || [])
    .filter((r) => r.partnerId === thread.userId && !r.chatThreadId)
    .map((r): MentionCandidate => ({ type: "referral", referralId: r.id, label: referralMentionLabel(r) }));
  const allMentionCandidates: MentionCandidate[] = [...mentionThreads, ...referralMentionCandidates];

  const createMentionThreadMutation = useMutation({
    mutationFn: async ({ candidate, query }: { candidate: MentionCandidate; query: string }) => {
      const body =
        candidate.type === "referral"
          ? { userId: thread.userId, referralId: candidate.referralId }
          : { userId: thread.userId, topic: query.trim() || "New chat" };
      const res = await apiRequest("POST", "/api/admin/chat/threads", body);
      return res.json() as Promise<ThreadRow>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] });
    },
  });

  async function resolveAdminMention(candidate: MentionCandidate, query: string): Promise<{ id: number; label: string }> {
    const created = await createMentionThreadMutation.mutateAsync({ candidate, query });
    return { id: created.id, label: threadMentionLabel(created) };
  }

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string; replyToMessageId?: number }) =>
      apiRequest("POST", `/api/admin/chat/threads/${thread.id}/messages`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setReplyingToId(null);
    },
  });

  // Lookup map for rendering quoted-reply previews inside bubbles -- the
  // bubble itself only has its own message, not the full list.
  const messagesById = new Map((messages || []).map((m) => [m.id, m]));
  const replyingToMessage = replyingToId != null ? messagesById.get(replyingToId) : null;

  const flagMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/admin/chat/messages/${id}/flag`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => apiRequest("PATCH", `/api/admin/chat/messages/${id}`, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
    onError: (err: any) => toast({ title: "Could not save edit", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => apiRequest("PATCH", `/api/admin/chat/threads/${thread.id}/archive`, { archived }),
    onSuccess: (_data, archived) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      toast({ title: archived ? "Chat archived" : "Chat unarchived" });
    },
    onError: (err: any) => toast({ title: "Could not update chat", description: err.message, variant: "destructive" }),
  });

  const [deleteThreadOpen, setDeleteThreadOpen] = useState(false);
  const deleteThreadMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/chat/threads/${thread.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setDeleteThreadOpen(false);
      toast({ title: "Chat deleted" });
      onCloseThread();
    },
    onError: (err: any) => toast({ title: "Could not delete chat", description: err.message, variant: "destructive" }),
  });

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: number; emoji: string }) => apiRequest("PATCH", `/api/admin/chat/messages/${id}/react`, { emoji }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const [deleteMessageId, setDeleteMessageId] = useState<number | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/chat/messages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      setDeleteMessageId(null);
    },
    onError: (err: any) => toast({ title: "Could not delete message", description: err.message, variant: "destructive" }),
  });

  const { toast } = useToast();
  const { user } = useAuth();
  const { data: admins } = useQuery<User[]>({ queryKey: ["/api/admin/team"] });
  const [todoMessageId, setTodoMessageId] = useState<number | null>(null);
  const [todoAssigneeId, setTodoAssigneeId] = useState<string>("");
  const [todoNote, setTodoNote] = useState("");

  const createTodoMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/admin/chat/messages/${todoMessageId}/todo`, {
        assignedToAdminId: Number(todoAssigneeId),
        note: todoNote.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/todos"] });
      toast({ title: "To-do created", description: "The assigned admin has been notified by email." });
      setTodoMessageId(null);
      setTodoAssigneeId("");
      setTodoNote("");
    },
    onError: (err: any) => toast({ title: "Could not create to-do", description: err.message, variant: "destructive" }),
  });

  const otherAdmins = (admins || []).filter((a) => a.id !== user?.id);

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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {!!thread.archivedAt && (
            <Badge variant="outline" className="text-xs shrink-0 no-default-hover-elevate no-default-active-elevate" data-testid="badge-thread-archived">
              Archived
            </Badge>
          )}
          {!!thread.archivedAt && !!thread.reactivationRequestedAt && (
            <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0" data-testid="text-reactivation-requested">
              <Undo2 className="h-3 w-3" /> Reopen requested
            </span>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="button-thread-menu" aria-label="Chat options">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => archiveMutation.mutate(!thread.archivedAt)} data-testid="menu-item-toggle-archive">
              {thread.archivedAt ? (
                <>
                  <ArchiveRestore className="h-4 w-4 mr-2" /> Unarchive chat
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-2" /> Archive chat
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteThreadOpen(true)}
              className="text-destructive focus:text-destructive"
              data-testid="menu-item-delete-thread"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
          <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer" />
        ) : !messages || messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No messages yet.</div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No messages match your search or filter.</div>
        ) : (
          filteredMessages.map((m) => {
            const quotedSource = m.replyToMessageId != null ? messagesById.get(m.replyToMessageId) : null;
            return (
              <ChatMessageBubble
                key={m.id}
                message={m}
                isMe={m.senderRole === "admin"}
                onToggleFlag={(id) => flagMutation.mutate(id)}
                onReact={(id, emoji) => reactMutation.mutate({ id, emoji })}
                isAdmin
                onCreateTodo={(id) => setTodoMessageId(id)}
                onDelete={(id) => setDeleteMessageId(id)}
                onEdit={m.senderId === user?.id ? (id, body) => editMutation.mutateAsync({ id, body }) : undefined}
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
        uploadUrl="/api/admin/chat/upload"
        threadId={thread.id}
        onSend={(payload) => sendMutation.mutateAsync(payload)}
        sending={sendMutation.isPending}
        testIdPrefix="admin-chat"
        mentionThreads={allMentionCandidates}
        onResolveMention={resolveAdminMention}
        replyingTo={replyingToMessage ? { id: replyingToMessage.id, senderName: replyingToMessage.senderName, snippet: replyingToMessage.deletedAt ? "Message deleted" : (replyingToMessage.body || "Attachment") } : null}
        onCancelReply={() => setReplyingToId(null)}
      />

      <Dialog open={todoMessageId !== null} onOpenChange={(open) => !open && setTodoMessageId(null)}>
        <DialogContent data-testid="dialog-create-todo">
          <DialogHeader>
            <DialogTitle>Create a to-do for another admin</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="todo-assignee">Assign to</Label>
              <Select value={todoAssigneeId} onValueChange={setTodoAssigneeId}>
                <SelectTrigger id="todo-assignee" data-testid="select-todo-assignee">
                  <SelectValue placeholder="Choose an admin" />
                </SelectTrigger>
                <SelectContent>
                  {otherAdmins.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="todo-note">Note</Label>
              <Textarea
                id="todo-note"
                value={todoNote}
                onChange={(e) => setTodoNote(e.target.value)}
                placeholder="What would you like them to do?"
                rows={4}
                data-testid="textarea-todo-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTodoMessageId(null)} data-testid="button-cancel-todo">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!todoAssigneeId || !todoNote.trim() || createTodoMutation.isPending}
              onClick={() => createTodoMutation.mutate()}
              data-testid="button-submit-todo"
            >
              Create to-do
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteMessageId !== null} onOpenChange={(open) => !open && setDeleteMessageId(null)}>
        <DialogContent data-testid="dialog-delete-message">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The message will be replaced with "This message was deleted" for everyone in this chat. This cannot be undone.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteMessageId(null)} data-testid="button-cancel-delete-message">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMessageId !== null && deleteMutation.mutate(deleteMessageId)}
              data-testid="button-confirm-delete-message"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteThreadOpen} onOpenChange={setDeleteThreadOpen}>
        <AlertDialogContent data-testid="dialog-delete-thread">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every message in this chat, along with any linked to-dos. Unlike archiving, this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-thread">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteThreadMutation.isPending}
              onClick={() => deleteThreadMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-thread"
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- ADMIN TEAM CHAT (Staff Room + private admin DMs) ----------
// Deliberately separate from ThreadDetail above -- staff messages have no
// senderRole/threadId columns (see schema.ts comment), so they're adapted
// onto ChatMessageWithMeta's shape locally instead of reusing ThreadDetail's
// partner/student-specific data model (referrals, mentions, flags).

type StaffSelection = { kind: "room" } | { kind: "dm"; threadId: number; otherAdminName: string } | null;

interface StaffDmThreadRow {
  id: number;
  otherAdminId: number;
  otherAdminName: string;
  otherAdminPhotoUrl: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: number;
  unread: boolean;
}

// Staff messages lack `senderRole`/`threadId` -- synthesize both so the
// shared ChatMessageBubble (typed against the partner/student ChatMessage
// shape) renders them unmodified. `threadId` is never read by the bubble
// itself, only carried on the type, so a sentinel is safe.
function toStaffBubbleMessage(m: { id: number; senderId: number; senderName: string; body: string; attachmentUrl: string | null; attachmentType: string | null; attachmentName: string | null; attachmentThumbnail?: string | null; attachmentProcessing?: boolean; replyToMessageId: number | null; createdAt: number; deletedAt: number | null; deletedByName: string | null; editedAt?: number | null }, threadId: number): ChatMessageWithMeta {
  return { ...m, threadId, senderRole: "admin" } as ChatMessageWithMeta;
}

function StaffChatSidebar({ onSelect, selected }: { onSelect: (s: StaffSelection) => void; selected: StaffSelection }) {
  const { user } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: dmThreads, isLoading } = useQuery<StaffDmThreadRow[]>({
    queryKey: ["/api/admin/staff-chat/dm/threads"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/staff-chat/dm/threads");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: admins } = useQuery<User[]>({
    queryKey: ["/api/admin/team"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/team");
      return res.json();
    },
    enabled: pickerOpen,
  });

  const createDmMutation = useMutation({
    mutationFn: async (otherAdminId: number) => {
      const res = await apiRequest("POST", "/api/admin/staff-chat/dm/threads", { otherAdminId });
      return res.json();
    },
    onSuccess: (thread: { id: number }, otherAdminId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff-chat/dm/threads"] });
      const other = admins?.find((a) => a.id === otherAdminId);
      onSelect({ kind: "dm", threadId: thread.id, otherAdminName: other?.name || "Teammate" });
      setPickerOpen(false);
    },
  });

  const otherAdmins = (admins || []).filter((a) => a.id !== user?.id);

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect({ kind: "room" })}
        className={cn(
          "text-left rounded-lg border p-3 hover-elevate active-elevate-2 cursor-pointer flex items-center gap-2",
          selected?.kind === "room" ? "border-primary bg-primary/5" : "border-card-border bg-card"
        )}
        data-testid="button-staff-chat-room"
      >
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <span className="text-base font-medium">Staff Room</span>
      </button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-center gap-1.5"
        onClick={() => setPickerOpen(true)}
        data-testid="button-new-staff-dm"
      >
        <Plus className="h-3.5 w-3.5" /> New direct message
      </Button>

      {isLoading ? (
        <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
      ) : (
        (dmThreads || []).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect({ kind: "dm", threadId: t.id, otherAdminName: t.otherAdminName })}
            className={cn(
              "text-left rounded-lg border p-3 hover-elevate active-elevate-2 cursor-pointer",
              selected?.kind === "dm" && selected.threadId === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card"
            )}
            data-testid={`button-staff-dm-thread-${t.id}`}
          >
            <div className="flex items-center gap-2">
              <UserAvatar photoUrl={t.otherAdminPhotoUrl} name={t.otherAdminName} size="sm" className="shrink-0" />
              <span className="flex items-center gap-1.5 min-w-0">
                {t.unread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-dm-${t.id}`} />}
                <span className={cn("text-base truncate", t.unread ? "font-semibold" : "font-medium")}>{t.otherAdminName}</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground truncate mt-0.5 ml-8">{t.lastMessagePreview || "No messages yet"}</p>
          </button>
        ))
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent data-testid="dialog-new-staff-dm">
          <DialogHeader>
            <DialogTitle>Start a direct message</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {otherAdmins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No other admins yet.</p>
            ) : (
              otherAdmins.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={createDmMutation.isPending}
                  onClick={() => createDmMutation.mutate(a.id)}
                  className="flex items-center gap-2 rounded-lg border border-card-border p-2 text-left hover-elevate active-elevate-2"
                  data-testid={`button-pick-admin-${a.id}`}
                >
                  <UserAvatar photoUrl={a.photoUrl} name={a.name} size="sm" />
                  <span className="text-sm font-medium">{a.name}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StaffChatDetail({ selection, onClose, showBackButton }: { selection: Exclude<StaffSelection, null>; onClose: () => void; showBackButton?: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const bottomRef = useRef<HTMLDivElement>(null);
  const isDm = selection.kind === "dm";
  const sentinelThreadId = isDm ? selection.threadId : 0;

  const messagesUrl = isDm ? `/api/admin/staff-chat/dm/threads/${selection.threadId}/messages` : "/api/admin/staff-chat/room/messages";
  const postUrl = messagesUrl;
  const patchBase = isDm ? "/api/admin/staff-chat/dm/messages" : "/api/admin/staff-chat/room/messages";
  const messagesKey = isDm ? ["/api/admin/staff-chat/dm/threads", selection.threadId, "messages"] : ["/api/admin/staff-chat/room/messages"];
  const [replyingToId, setReplyingToId] = useState<number | null>(null);

  const { data: rawMessages, isLoading } = useQuery<any[]>({
    queryKey: messagesKey,
    queryFn: async () => {
      const res = await apiRequest("GET", messagesUrl);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const messages = (rawMessages || []).map((m) => toStaffBubbleMessage(m, sentinelThreadId));

  // Lookup map for rendering quoted-reply previews inside bubbles -- the
  // bubble itself only has its own message, not the full list.
  const messagesById = new Map(messages.map((m) => [m.id, m]));
  const replyingToMessage = replyingToId != null ? messagesById.get(replyingToId) : null;

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string; replyToMessageId?: number }) =>
      apiRequest("POST", postUrl, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      if (isDm) queryClient.invalidateQueries({ queryKey: ["/api/admin/staff-chat/dm/threads"] });
      setReplyingToId(null);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => apiRequest("PATCH", `${patchBase}/${id}`, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${patchBase}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
      if (isDm) queryClient.invalidateQueries({ queryKey: ["/api/admin/staff-chat/dm/threads"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex-1 flex flex-col min-w-0 gap-3">
      <div className="flex items-center gap-2 shrink-0 pb-1 border-b border-border">
        {showBackButton && (
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-staff-chat-mobile">Back</Button>
        )}
        {isDm ? (
          <span className="flex items-center gap-2 text-sm font-medium truncate">
            <UserAvatar name={selection.otherAdminName} size="sm" />
            <span className="truncate">{selection.otherAdminName}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-primary" /> Staff Room
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3 min-h-0">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer self-start" />
            <Skeleton className="h-12 w-1/2 rounded-lg skeleton-shimmer self-end" />
          </>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <Users className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm max-w-xs">{isDm ? "No messages yet. Say hello." : "No messages yet in the Staff Room."}</p>
          </div>
        ) : (
          messages.map((m) => {
            const quotedSource = m.replyToMessageId != null ? messagesById.get(m.replyToMessageId) : null;
            return (
              <ChatMessageBubble
                key={m.id}
                message={m}
                isMe={m.senderId === user?.id}
                isAdmin
                hideFlag
                hideReactions
                onToggleFlag={() => {}}
                onReact={() => {}}
                onReply={(id) => setReplyingToId(id)}
                quoted={quotedSource ? { senderName: quotedSource.senderName, snippet: quotedSource.deletedAt ? "Message deleted" : (quotedSource.body || "Attachment") } : m.replyToMessageId ? { senderName: "", snippet: "Original message unavailable" } : null}
                onDelete={m.senderId === user?.id ? (id) => deleteMutation.mutate(id) : undefined}
                onEdit={m.senderId === user?.id ? (id, body) => editMutation.mutateAsync({ id, body }) : undefined}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        key={isDm ? `dm-${selection.threadId}` : "room"}
        uploadUrl="/api/admin/staff-chat/upload"
        threadId={sentinelThreadId}
        onSend={(payload) => sendMutation.mutateAsync(payload)}
        sending={sendMutation.isPending}
        testIdPrefix="staff-chat"
        placeholder={isDm ? `Message ${selection.otherAdminName}...` : "Message the team..."}
        replyingTo={replyingToMessage ? { id: replyingToMessage.id, senderName: replyingToMessage.senderName, snippet: replyingToMessage.deletedAt ? "Message deleted" : (replyingToMessage.body || "Attachment") } : null}
        onCancelReply={() => setReplyingToId(null)}
      />
    </div>
  );
}
