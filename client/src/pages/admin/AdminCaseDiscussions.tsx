import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CaseDiscussion } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Plus, Trash2, Loader2, Pencil, Users, ExternalLink } from "lucide-react";
import { format } from "date-fns";

type CaseDiscussionRow = CaseDiscussion & { rsvpCount: number };
type Attendee = { userId: number; name: string; email: string; clinicName: string | null };

const EMPTY_FORM = {
  topic: "Partner Case Discussion",
  presenterName: "",
  datetime: "",
  zoomLink: "https://zoom.us/j/0000000000",
  notes: "",
};

// Convert an epoch-ms value to the "YYYY-MM-DDTHH:mm" string a
// <input type="datetime-local"> expects (in the admin's local timezone).
function toDatetimeLocal(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminCaseDiscussions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: discussions, isLoading } = useQuery<CaseDiscussionRow[]>({
    queryKey: ["/api/admin/case-discussions"],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [attendeesFor, setAttendeesFor] = useState<CaseDiscussionRow | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/case-discussions"] });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (d: CaseDiscussionRow) => {
    setEditingId(d.id);
    setForm({
      topic: d.topic,
      presenterName: d.presenterName ?? "",
      datetime: toDatetimeLocal(d.scheduledAt),
      zoomLink: d.zoomLink,
      notes: d.notes ?? "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        topic: form.topic,
        presenterName: form.presenterName.trim() ? form.presenterName.trim() : null,
        scheduledAt: new Date(form.datetime).getTime(),
        zoomLink: form.zoomLink,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
      if (editingId != null) {
        return apiRequest("PATCH", `/api/admin/case-discussions/${editingId}`, payload);
      }
      return apiRequest("POST", "/api/admin/case-discussions", payload);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({ title: editingId != null ? "Case discussion updated" : "Case discussion created" });
    },
    onError: () => toast({ title: "Could not save", description: "Please check the fields and try again.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/case-discussions/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Case discussion deleted" });
    },
  });

  const sorted = [...(discussions || [])].sort((a, b) => b.scheduledAt - a.scheduledAt);
  const canSave = form.topic.trim() && form.datetime && form.zoomLink.trim();

  return (
    <div className="max-w-5xl flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Schedule the recurring partner case discussions. Partners can RSVP, download a calendar invite, and
        receive a Zoom push reminder when a session starts.
      </p>

      <Button size="sm" className="self-start" onClick={openCreate} data-testid="button-add-case-discussion">
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add case discussion
      </Button>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : sorted.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No case discussions" description="Create your first partner case discussion." />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Topic</th>
                  <th className="px-4 py-3 font-medium">Presenter</th>
                  <th className="px-4 py-3 font-medium">Date &amp; time</th>
                  <th className="px-4 py-3 font-medium">RSVPs</th>
                  <th className="px-4 py-3 font-medium">Zoom</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0" data-testid={`row-case-discussion-${d.id}`}>
                    <td className="px-4 py-3">{d.topic}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.presenterName || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{format(new Date(d.scheduledAt), "MMM d, yyyy HH:mm")}</td>
                    <td className="px-4 py-3 tabular-nums" data-testid={`text-rsvp-count-${d.id}`}>{d.rsvpCount}</td>
                    <td className="px-4 py-3">
                      <a href={d.zoomLink} target="_blank" rel="noopener noreferrer" className="text-primary flex items-center gap-1">
                        <ExternalLink className="h-3.5 w-3.5" /> Link
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button size="icon" variant="ghost" onClick={() => setAttendeesFor(d)} aria-label="View attendees" data-testid={`button-view-attendees-${d.id}`}>
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(d)} aria-label="Edit" data-testid={`button-edit-case-discussion-${d.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(d.id)} aria-label="Delete" data-testid={`button-delete-case-discussion-${d.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-case-discussion-form">
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Edit case discussion" : "Add case discussion"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-topic">Topic / case title</Label>
              <Input id="cd-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} data-testid="input-case-discussion-topic" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-presenter">Presenter name (optional)</Label>
              <Input id="cd-presenter" value={form.presenterName} onChange={(e) => setForm({ ...form, presenterName: e.target.value })} data-testid="input-case-discussion-presenter" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-datetime">Date &amp; time</Label>
              <Input id="cd-datetime" type="datetime-local" value={form.datetime} onChange={(e) => setForm({ ...form, datetime: e.target.value })} data-testid="input-case-discussion-datetime" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-zoom">Zoom link</Label>
              <Input id="cd-zoom" value={form.zoomLink} onChange={(e) => setForm({ ...form, zoomLink: e.target.value })} data-testid="input-case-discussion-zoom" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-notes">Notes (optional)</Label>
              <Textarea id="cd-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="textarea-case-discussion-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending} data-testid="button-save-case-discussion">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attendees dialog */}
      <AttendeesDialog discussion={attendeesFor} onClose={() => setAttendeesFor(null)} />
    </div>
  );
}

function AttendeesDialog({ discussion, onClose }: { discussion: CaseDiscussionRow | null; onClose: () => void }) {
  const { data: attendees, isLoading } = useQuery<Attendee[]>({
    queryKey: ["/api/admin/case-discussions", discussion?.id, "attendees"],
    enabled: !!discussion,
  });

  return (
    <Dialog open={!!discussion} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="dialog-case-discussion-attendees">
        <DialogHeader>
          <DialogTitle>Attendees{discussion ? ` — ${discussion.topic}` : ""}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 rounded-lg skeleton-shimmer" />
        ) : !attendees || attendees.length === 0 ? (
          <EmptyState icon={Users} title="No RSVPs yet" description="Partners who RSVP will appear here." />
        ) : (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
            {attendees.map((a) => (
              <div key={a.userId} className="flex flex-col rounded-md border border-card-border bg-card px-4 py-2.5 text-sm" data-testid={`row-attendee-${a.userId}`}>
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.email}</span>
                {a.clinicName && <span className="text-xs text-muted-foreground">{a.clinicName}</span>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
