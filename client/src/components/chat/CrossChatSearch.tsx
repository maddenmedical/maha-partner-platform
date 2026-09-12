import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Stethoscope, MessageSquare } from "lucide-react";
import { format } from "date-fns";

interface SearchResult {
  id: number;
  threadId: number;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: number;
  threadTopic: string;
  threadKind: string;
  ownerName?: string | null;
}

interface CrossChatSearchProps {
  searchUrl: string;
  onSelectThread: (threadId: number) => void;
  testIdPrefix?: string;
}

// Search box across every one of the user's own chat threads (or, for the
// admin inbox, every thread in the system) -- as opposed to the per-thread
// "Search messages..." box which only searches the currently open chat.
export function CrossChatSearch({ searchUrl, onSelectThread, testIdPrefix = "cross-chat" }: CrossChatSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results, isFetching } = useQuery<SearchResult[]>({
    queryKey: [searchUrl, debounced],
    queryFn: async () => {
      const res = await apiRequest("GET", `${searchUrl}?q=${encodeURIComponent(debounced)}`);
      return res.json();
    },
    enabled: open && debounced.length >= 2,
  });

  function handleSelect(threadId: number) {
    onSelectThread(threadId);
    setOpen(false);
    setQuery("");
  }

  function highlight(body: string) {
    if (!debounced) return body;
    const idx = body.toLowerCase().indexOf(debounced.toLowerCase());
    if (idx === -1) return body;
    const start = Math.max(0, idx - 30);
    const end = Math.min(body.length, idx + debounced.length + 40);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < body.length ? "…" : "";
    const before = body.slice(start, idx);
    const match = body.slice(idx, idx + debounced.length);
    const after = body.slice(idx + debounced.length, end);
    return (
      <>
        {prefix}
        {before}
        <mark className="bg-primary/20 text-foreground rounded-sm">{match}</mark>
        {after}
        {suffix}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={() => setOpen(true)}
        data-testid={`button-${testIdPrefix}-open`}
      >
        <Search className="h-4 w-4" /> Search all chats
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search all chats</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across every conversation..."
            className="pl-8"
            data-testid={`input-${testIdPrefix}-query`}
          />
        </div>
        <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto overscroll-contain -mx-1 px-1">
          {debounced.length > 0 && debounced.length < 2 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Keep typing to search...</p>
          ) : isFetching ? (
            <>
              <Skeleton className="h-14 rounded-lg skeleton-shimmer" />
              <Skeleton className="h-14 rounded-lg skeleton-shimmer" />
            </>
          ) : debounced.length >= 2 && (!results || results.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid={`text-${testIdPrefix}-empty`}>
              No messages match "{debounced}".
            </p>
          ) : (
            results?.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelect(r.threadId)}
                className="text-left rounded-lg border border-card-border bg-card p-3 hover-elevate active-elevate-2"
                data-testid={`row-${testIdPrefix}-result-${r.id}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {r.threadKind === "referral" && <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span className="text-sm font-medium truncate">{r.threadTopic}</span>
                  {r.ownerName && (
                    <span className="text-xs text-muted-foreground truncate shrink-0">· {r.ownerName}</span>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                    {format(new Date(r.createdAt), "MMM d")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  <span className="font-medium text-foreground">{r.senderName}: </span>
                  {highlight(r.body)}
                </p>
              </button>
            ))
          )}
          {debounced.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground gap-2 py-8">
              <MessageSquare className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm max-w-xs">Type at least 2 characters to search every conversation at once.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
