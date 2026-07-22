import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Announcement } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Megaphone, Loader2, Send, ExternalLink } from "lucide-react";
import { format } from "date-fns";

type Audience = "all" | "partners" | "students";

const AUDIENCE_LABELS: Record<string, string> = {
  all: "Everyone",
  partners: "Partners",
  students: "Students",
};

export default function AdminAnnouncements() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<Audience>("all");

  const { data: history, isLoading } = useQuery<Announcement[]>({ queryKey: ["/api/admin/announcements"] });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/announcements", {
        title, body, url: url.trim() || undefined, audience,
      });
      return res.json();
    },
    onSuccess: (data: { sent: number; failed: number; removed: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      toast({
        title: "Announcement sent",
        description: `Delivered to ${data.sent} device${data.sent !== 1 ? "s" : ""}` +
          (data.failed ? ` · ${data.failed} failed` : "") +
          (data.removed ? ` · ${data.removed} expired removed` : ""),
      });
      setTitle("");
      setBody("");
      setUrl("");
      setAudience("all");
    },
    onError: (err: any) => {
      toast({ title: "Could not send announcement", description: err.message, variant: "destructive" });
    },
  });

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !sendMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canSend) sendMutation.mutate();
  }

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <Card>
        <CardContent className="p-4 md:p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New spring discount on OMNI EM Ferment"
                data-testid="input-announcement-title"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea
                id="ann-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Order before the end of the month to get 15% off…"
                rows={4}
                data-testid="input-announcement-body"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-url">Link URL (optional)</Label>
              <Input
                id="ann-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://partner.maha.clinic/…"
                data-testid="input-announcement-url"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-audience">Audience</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                <SelectTrigger id="ann-audience" data-testid="select-announcement-audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-audience-all">Everyone</SelectItem>
                  <SelectItem value="partners" data-testid="option-audience-partners">Partners</SelectItem>
                  <SelectItem value="students" data-testid="option-audience-students">Students</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!canSend} data-testid="button-send-announcement">
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send announcement
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">History</h2>
        {isLoading ? (
          <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
        ) : !history || history.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements yet" description="Sent announcements will appear here." />
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((a) => (
              <Card key={a.id} data-testid={`card-announcement-${a.id}`}>
                <CardContent className="p-4 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-snug">{a.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{AUDIENCE_LABELS[a.audience] ?? a.audience}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" /> {a.url}
                    </a>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(a.sentAt), "MMM d, yyyy 'at' HH:mm")} · {a.recipientCount} recipient{a.recipientCount !== 1 ? "s" : ""}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
