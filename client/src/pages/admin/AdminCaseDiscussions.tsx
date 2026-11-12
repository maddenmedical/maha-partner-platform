import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, API_BASE } from "@/lib/queryClient";
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
import { CalendarClock, Plus, Trash2, Loader2, Pencil, Users, ExternalLink, CalendarPlus } from "lucide-react";
import { format } from "date-fns";

type CaseDiscussionRow = CaseDiscussion & { rsvpCount: number };
type Attendee = { userId: number; name: string; email: string; clinicName: string | null };

const EMPTY_FORM = {
  topic: "",
  presenterName: "",
  datetime: "",
  endDatetime: "",
  registrationMode: "app",
  attachments: [] as NonNullable<CaseDiscussion["attachments"]>,
  zoomLink: "",
  notes: "",
};

// Same pattern as the partner-facing download in PartnerHome.tsx: fetch the
// .ics as a blob (so the browser's auth cookie is sent) rather than linking
// directly to the URL, then trigger a synthetic download.
async function downloadIcal(id: number, topic: string) {
  const res = await fetch(`${API_BASE}/api/case-discussions/${id}/ical`, { credentials: "include" });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${topic.replace(/[^a-z0-9]+/gi, "-") || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
  const [uploading, setUploading] = useState(false);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (form.attachments.length + files.length > 10) {
      toast({ title: "Maximum 10 attachments per event", variant: "destructive" }); return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is larger than 20 MB.`);
        const body = new FormData(); body.append("file", file);
        const response = await fetch(`${API_BASE}/api/admin/event-attachments`, { method: "POST", credentials: "include", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Upload failed.");
        setForm(current => ({ ...current, attachments: [...current.attachments, result] }));
      }
    } catch (error) {
      toast({ title: "Attachment not uploaded", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setUploading(false); }
  }

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
      endDatetime: d.endsAt ? toDatetimeLocal(d.endsAt) : "",
      registrationMode: d.registrationMode || "app",
      attachments: d.attachments ?? [],
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
        endsAt: form.endDatetime ? new Date(form.endDatetime).getTime() : null,
        registrationMode: form.registrationMode,
        attachments: form.attachments,
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
      toast({ title: editingId != null ? "Event updated" : "Event created" });
    },
    onError: () => toast({ title: "Could not save", description: "Please check the fields and try again.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/case-discussions/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Event deleted" });
    },
  });

  const sorted = [...(discussions || [])].sort((a, b) => b.scheduledAt - a.scheduledAt);
  const validEnd = !form.endDatetime || new Date(form.endDatetime).getTime() > new Date(form.datetime).getTime();
  const canSave = form.topic.trim() && form.datetime && /^https?:\/\/\S+$/i.test(form.zoomLink.trim()) && validEnd;

  return (
    <div className="max-w-5xl flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Schedule single-day or multi-day events. Choose registration in the app or on an external website, and attach programmes or other event files.
      </p>

      <Button size="sm" className="self-start" onClick={openCreate} data-testid="button-add-case-discussion">
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add event
      </Button>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : sorted.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No events yet" description="Create your first event." />
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
                  <th className="px-4 py-3 font-medium">Link</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0" data-testid={`row-case-discussion-${d.id}`}>
                    <td className="px-4 py-3">{d.topic}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.presenterName || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{format(new Date(d.scheduledAt), "MMM d, yyyy HH:mm")}
                      {d.endsAt && <span className="block">to {format(new Date(d.endsAt), "MMM d, yyyy HH:mm")}</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums" data-testid={`text-rsvp-count-${d.id}`}>{d.registrationMode === "external" ? `External${d.rsvpCount ? ` (${d.rsvpCount} earlier app RSVPs)` : ""}` : d.rsvpCount}</td>
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
                        <Button size="icon" variant="ghost" onClick={() => downloadIcal(d.id, d.topic)} aria-label="Download calendar invite" data-testid={`button-download-ical-${d.id}`}>
                          <CalendarPlus className="h-3.5 w-3.5" />
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
      <Dialog open={dialogOpen} onOpenChange={open => { if (!uploading && !saveMutation.isPending) setDialogOpen(open); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto rounded-lg grid-cols-[minmax(0,1fr)] [&>*]:min-w-0" data-testid="dialog-case-discussion-form">
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Edit event" : "Add event"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-topic">Title</Label>
              <Input id="cd-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} data-testid="input-case-discussion-topic" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-presenter">Presenter name (optional)</Label>
              <Input id="cd-presenter" value={form.presenterName} onChange={(e) => setForm({ ...form, presenterName: e.target.value })} data-testid="input-case-discussion-presenter" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-datetime">Start date &amp; time</Label>
              <Input className="min-w-0 max-w-full" id="cd-datetime" type="datetime-local" value={form.datetime} onChange={(e) => setForm({ ...form, datetime: e.target.value })} data-testid="input-case-discussion-datetime" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-end">End date &amp; time (optional)</Label>
              <Input className="min-w-0 max-w-full" id="cd-end" type="datetime-local" value={form.endDatetime} onChange={e => setForm({ ...form, endDatetime: e.target.value })} data-testid="input-case-discussion-end" />
              <p className="text-xs text-muted-foreground">For multi-day events, choose the final day. Times use your device's local time zone. Without an end time, the calendar reserves one hour.</p>
              {!validEnd && <p role="alert" className="text-xs text-destructive">End must be after start.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-zoom">Link</Label>
              <Input id="cd-zoom" type="url" placeholder="https://" value={form.zoomLink} onChange={(e) => setForm({ ...form, zoomLink: e.target.value })} data-testid="input-case-discussion-zoom" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-registration">Registration</Label>
              <select id="cd-registration" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.registrationMode} onChange={e => setForm({ ...form, registrationMode: e.target.value })}>
                <option value="app">Register in the app</option>
                <option value="external">Register on the linked website</option>
              </select>
              <p className="text-xs text-muted-foreground">{form.registrationMode === "external"
                ? "Partners follow the link above to register. External registrations are not tracked in the app. Earlier app RSVPs are retained."
                : "Partners register here and receive access to the event link."}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cd-files">Attachments (optional)</Label>
              <Input id="cd-files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp" disabled={uploading || saveMutation.isPending || form.attachments.length >= 10}
                onChange={e => { uploadFiles(e.target.files); e.target.value = ""; }} />
              <p className="text-xs text-muted-foreground">PDF, Word, Excel, PowerPoint or images. Up to 10 files, 20 MB each. Save the event to make them available to partners.</p>
              {uploading && <p role="status" className="text-sm">Uploading attachment…</p>}
              {form.attachments.map((file, index) => <div key={`${file.url}-${index}`} className="flex min-w-0 items-center gap-2 rounded border p-2">
                <span className="min-w-0 flex-1 break-all text-sm">{file.name}</span>
                <Button size="icon" variant="ghost" disabled={uploading || saveMutation.isPending} aria-label={`Remove ${file.name}`} onClick={() => setForm(current => ({ ...current, attachments: current.attachments.filter((_, i) => i !== index) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>)}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-notes">Notes (optional)</Label>
              <Textarea id="cd-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="textarea-case-discussion-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending || uploading} data-testid="button-save-case-discussion">
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
