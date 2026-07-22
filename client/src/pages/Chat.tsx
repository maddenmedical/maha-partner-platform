import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { ChatThread, ChatMessage } from "@shared/schema";

interface ThreadData {
  thread: ChatThread;
  messages: ChatMessage[];
}

export default function Chat({ label = "Chat with MAHA Team" }: { label?: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<ThreadData>({
    queryKey: ["/api/chat/my-thread"],
    refetchInterval: 5000,
  });

  const mutation = useMutation({
    mutationFn: (text: string) => apiRequest("POST", "/api/chat/my-thread/messages", { body: text }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/my-thread"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages.length]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    mutation.mutate(body.trim());
  }

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-9.5rem)]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground mt-1">Messages are private between you and the MAHA team.</p>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3 pb-4">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-2/3 rounded-lg skeleton-shimmer self-start" />
            <Skeleton className="h-12 w-1/2 rounded-lg skeleton-shimmer self-end" />
          </>
        ) : !data || data.messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm max-w-xs">No messages yet. Say hello — the MAHA team typically responds within one business day.</p>
          </div>
        ) : (
          data.messages.map((m) => {
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
