import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@shared/schema";

interface ThreadRow {
  id: number;
  userId: number;
  userRole: string;
  topic?: string;
  userName?: string;
  userEmail?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  messageCount: number;
}

export default function AdminChatInbox() {
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
  const { data: threads, isLoading } = useQuery<ThreadRow[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 5000,
  });

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] gap-4 max-w-5xl -m-1">
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
                selectedThread?.id === t.id ? "border-primary bg-primary/5" : "border-card-border bg-card"
              )}
              data-testid={`button-thread-${t.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{t.userName}</span>
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
          <ThreadDetail thread={selectedThread} />
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
            <span className="text-sm font-medium">{selectedThread.userName}</span>
          </div>
          <ThreadDetail thread={selectedThread} />
        </div>
      )}
    </div>
  );
}

function ThreadDetail({ thread }: { thread: ThreadRow }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/admin/chat/threads", thread.id, "messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/chat/threads/${thread.id}/messages`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const mutation = useMutation({
    mutationFn: (text: string) => apiRequest("POST", `/api/admin/chat/threads/${thread.id}/messages`, { body: text }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads", thread.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  return (
    <Card className="flex-1 flex flex-col min-w-0">
      <CardContent className="flex-1 flex flex-col p-4 gap-3 min-h-0">
        <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3">
          {isLoading ? (
            <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer" />
          ) : (
            messages?.map((m) => (
              <div key={m.id} className={cn("flex flex-col max-w-[75%]", m.senderRole === "admin" ? "self-end items-end" : "self-start items-start")} data-testid={`admin-message-${m.id}`}>
                <div className={cn("rounded-lg px-3 py-2 text-sm", m.senderRole === "admin" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.body}
                </div>
                <span className="text-xs text-muted-foreground mt-1 px-1">{m.senderName} · {format(new Date(m.createdAt), "MMM d, HH:mm")}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (body.trim()) mutation.mutate(body.trim()); }}
          className="flex items-end gap-2 border-t border-border pt-3"
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Reply..."
            rows={1}
            className="resize-none min-h-9"
            data-testid="textarea-admin-reply"
          />
          <Button type="submit" size="icon" disabled={mutation.isPending || !body.trim()} data-testid="button-admin-send">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
