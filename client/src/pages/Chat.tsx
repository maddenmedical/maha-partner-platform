import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { Send, MessageSquare, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { ChatThread, ChatMessage } from "@shared/schema";

interface ThreadRow extends ChatThread {
  lastMessage?: string;
  lastMessageAt?: number;
  messageCount: number;
}

export default function Chat({ label = "Chat with MAHA Team" }: { label?: string }) {
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
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

  // Keep the selected thread's preview data in sync as the list refetches.
  useEffect(() => {
    if (!selectedThread || !threads) return;
    const fresh = threads.find((t) => t.id === selectedThread.id);
    if (fresh && (fresh.lastMessage !== selectedThread.lastMessage || fresh.messageCount !== selectedThread.messageCount)) {
      setSelectedThread(fresh);
    }
  }, [threads, selectedThread]);

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
                    selectedThread?.id === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card"
                  )}
                  data-testid={`button-thread-${t.id}`}
                >
                  <span className="text-sm font-medium truncate block">{t.topic}</span>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{t.lastMessage || "No messages yet"}</p>
                </button>
              ))
          )}
        </div>

        <div className="flex-1 min-w-0 hidden sm:flex">
          {selectedThread ? (
            <ThreadDetail thread={selectedThread} />
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
              <span className="text-sm font-medium truncate">{selectedThread.topic}</span>
            </div>
            <ThreadDetail thread={selectedThread} />
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadDetail({ thread }: { thread: ThreadRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/threads", thread.id, "messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chat/threads/${thread.id}/messages`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const mutation = useMutation({
    mutationFn: (text: string) => apiRequest("POST", `/api/chat/threads/${thread.id}/messages`, { body: text }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", thread.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    mutation.mutate(body.trim());
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 border border-card-border rounded-lg bg-card p-4 gap-3">
      <div className="hidden sm:block border-b border-border pb-2 -mt-1">
        <span className="text-sm font-medium">{thread.topic}</span>
      </div>
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
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === user?.id && m.senderRole === user?.role;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col max-w-[80%]", isMe ? "self-end items-end" : "self-start items-start")}
                data-testid={`message-${m.id}`}
              >
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm",
                    isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  )}
                >
                  {m.body}
                </div>
                <span className="text-xs text-muted-foreground mt-1 px-1">
                  {isMe ? "You" : m.senderName} · {format(new Date(m.createdAt), "MMM d, HH:mm")}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-border pt-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a message..."
          rows={1}
          className="resize-none min-h-9"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          data-testid="textarea-chat-message"
        />
        <Button type="submit" size="icon" disabled={mutation.isPending || !body.trim()} data-testid="button-send-message">
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
