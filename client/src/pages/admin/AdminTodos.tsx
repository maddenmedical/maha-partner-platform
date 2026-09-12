import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListTodo, CheckCircle2, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { setPendingThreadId } from "@/lib/chatNav";
import { useLocation } from "wouter";

interface AdminTodoRow {
  id: number;
  messageId: number;
  threadId: number;
  createdByAdminId: number;
  assignedToAdminId: number;
  note: string;
  status: "open" | "done";
  createdAt: number;
  completedAt: number | null;
  createdByName: string;
  assignedToName: string;
  messageSnippet: string | null;
  threadTopic: string | null;
}

export default function AdminTodos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: todos, isLoading } = useQuery<AdminTodoRow[]>({
    queryKey: ["/api/admin/todos"],
    refetchInterval: 10000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "open" | "done" }) =>
      apiRequest("PATCH", `/api/admin/todos/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/todos"] }),
    onError: (err: any) => toast({ title: "Could not update to-do", description: err.message, variant: "destructive" }),
  });

  function openThread(threadId: number) {
    setPendingThreadId(threadId);
    navigate("/admin/chat");
  }

  const open = (todos || []).filter((t) => t.status === "open");
  const done = (todos || []).filter((t) => t.status === "done");

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {isLoading ? (
        <>
          <Skeleton className="h-20 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-20 rounded-lg skeleton-shimmer" />
        </>
      ) : !todos || todos.length === 0 ? (
        <EmptyState icon={ListTodo} title="No to-dos yet" description="Flag a chat message with the to-do icon to hand it off to another admin." />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Open ({open.length})</h2>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing open right now.</p>
            ) : (
              open.map((t) => (
                <TodoCard key={t.id} todo={t} onOpenThread={openThread} onMarkDone={(id) => statusMutation.mutate({ id, status: "done" })} />
              ))
            )}
          </section>

          {done.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Done ({done.length})</h2>
              {done.map((t) => (
                <TodoCard key={t.id} todo={t} onOpenThread={openThread} onMarkDone={(id) => statusMutation.mutate({ id, status: "open" })} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TodoCard({
  todo: t,
  onOpenThread,
  onMarkDone,
}: {
  todo: AdminTodoRow;
  onOpenThread: (threadId: number) => void;
  onMarkDone: (id: number) => void;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-3 flex flex-col gap-2" data-testid={`card-todo-${t.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
          <span>From <span className="font-medium text-foreground">{t.createdByName}</span></span>
          <span>→</span>
          <span>To <span className="font-medium text-foreground">{t.assignedToName}</span></span>
          {t.threadTopic && <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">{t.threadTopic}</Badge>}
        </div>
        <Badge variant={t.status === "done" ? "outline" : "default"} className="text-xs capitalize shrink-0 no-default-hover-elevate no-default-active-elevate">
          {t.status}
        </Badge>
      </div>
      <p className="text-sm" data-testid={`text-todo-note-${t.id}`}>{t.note}</p>
      {t.messageSnippet && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2 line-clamp-2">"{t.messageSnippet}"</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-xs text-muted-foreground">
          {format(new Date(t.createdAt), "MMM d, HH:mm")}
          {t.completedAt ? ` · done ${format(new Date(t.completedAt), "MMM d, HH:mm")}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onOpenThread(t.threadId)} data-testid={`button-open-thread-${t.id}`}>
            Open chat <ArrowUpRight className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={t.status === "done" ? "outline" : "default"}
            className="h-7 gap-1 text-xs"
            onClick={() => onMarkDone(t.id)}
            data-testid={`button-toggle-done-${t.id}`}
          >
            <CheckCircle2 className="h-3 w-3" /> {t.status === "done" ? "Reopen" : "Mark done"}
          </Button>
        </div>
      </div>
    </div>
  );
}
