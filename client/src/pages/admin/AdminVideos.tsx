import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Course, Video, User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Plus, Trash2, Pencil, Loader2, Lock, Users, PlayCircle, AlertCircle } from "lucide-react";

// /api/courses never sends the raw video URL (see server/routes.ts) — only
// a hasVideo flag. The edit form fetches the real URL on demand from the
// admin-only /api/admin/videos/:id endpoint.
type LessonSummary = Omit<Video, "url"> & { hasVideo: boolean };
type CourseWithLessons = Course & { lessons: LessonSummary[]; lessonCount: number; hasAccess: boolean };
type LearnDashCourse = { id: number; title: string; link: string };
type LearnDashCoursesResponse = { configured: boolean; courses: LearnDashCourse[]; error?: string };
type Grant = { id: number; partnerId: number; partnerName?: string; partnerEmail?: string };
type Purchase = {
  id: number;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: number;
  partnerName?: string;
  partnerEmail?: string;
  courseName?: string;
};

const ACCESS_LABELS: Record<string, string> = {
  open: "Free (open)",
  enroll: "Free (enroll)",
  paid: "Paid",
};

function formatPrice(cents: number, currency: string) {
  const symbol = currency.toLowerCase() === "eur" ? "€" : "";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export default function AdminVideos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: courses, isLoading } = useQuery<CourseWithLessons[]>({ queryKey: ["/api/courses"] });
  const { data: partners } = useQuery<User[]>({ queryKey: ["/api/admin/partners"] });
  const { data: purchases } = useQuery<Purchase[]>({ queryKey: ["/api/admin/course-purchases"] });
  const { data: learndash } = useQuery<LearnDashCoursesResponse>({ queryKey: ["/api/admin/learndash/courses"] });

  // Course create/edit dialog
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseForm, setCourseForm] = useState({ name: "", description: "", accessType: "open", priceEur: "", learndashCourseId: "" });

  // Lesson create/edit dialog
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonSummary | null>(null);
  const [lessonForm, setLessonForm] = useState({ courseId: 0, title: "", description: "", url: "" });
  const [lessonUrlLoading, setLessonUrlLoading] = useState(false);

  // Grants dialog
  const [grantsOpen, setGrantsOpen] = useState<Course | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<string>("");

  const { data: grants } = useQuery<Grant[]>({
    queryKey: ["/api/admin/courses", grantsOpen?.id, "grants"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/courses/${grantsOpen!.id}/grants`);
      return res.json();
    },
    enabled: !!grantsOpen,
  });

  function openCreateCourse() {
    setEditingCourse(null);
    setCourseForm({ name: "", description: "", accessType: "open", priceEur: "", learndashCourseId: "" });
    setCourseDialogOpen(true);
  }
  function openEditCourse(c: Course) {
    setEditingCourse(c);
    setCourseForm({
      name: c.name,
      description: c.description || "",
      accessType: c.accessType,
      priceEur: c.priceCents ? (c.priceCents / 100).toFixed(2) : "",
      learndashCourseId: c.learndashCourseId ? String(c.learndashCourseId) : "",
    });
    setCourseDialogOpen(true);
  }

  function openCreateLesson(courseId: number) {
    setEditingLesson(null);
    setLessonForm({ courseId, title: "", description: "", url: "" });
    setLessonDialogOpen(true);
  }
  async function openEditLesson(v: LessonSummary) {
    setEditingLesson(v);
    setLessonForm({ courseId: v.courseId || 0, title: v.title, description: v.description || "", url: "" });
    setLessonDialogOpen(true);
    setLessonUrlLoading(true);
    try {
      const res = await apiRequest("GET", `/api/admin/videos/${v.id}`);
      const full: Video = await res.json();
      setLessonForm((prev) => ({ ...prev, url: full.url || "" }));
    } catch {
      toast({ title: "Could not load the current video link", variant: "destructive" });
    } finally {
      setLessonUrlLoading(false);
    }
  }

  const saveCourseMutation = useMutation({
    mutationFn: async () => {
      const priceCents =
        courseForm.accessType === "paid" ? Math.round(parseFloat(courseForm.priceEur || "0") * 100) : null;
      const payload = {
        name: courseForm.name,
        description: courseForm.description,
        accessType: courseForm.accessType,
        priceCents,
        learndashCourseId: courseForm.learndashCourseId ? Number(courseForm.learndashCourseId) : null,
      };
      if (editingCourse) return apiRequest("PATCH", `/api/admin/courses/${editingCourse.id}`, payload);
      return apiRequest("POST", "/api/admin/courses", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setCourseDialogOpen(false);
      toast({ title: editingCourse ? "Course updated" : "Course created" });
    },
    onError: (e: Error) => toast({ title: "Could not save course", description: e.message, variant: "destructive" }),
  });

  const deleteCourseMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/courses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course deleted" });
    },
  });

  const saveLessonMutation = useMutation({
    mutationFn: async () => {
      if (editingLesson) {
        return apiRequest("PATCH", `/api/admin/videos/${editingLesson.id}`, {
          title: lessonForm.title,
          description: lessonForm.description,
          url: lessonForm.url,
          courseId: lessonForm.courseId,
        });
      }
      return apiRequest("POST", "/api/admin/videos", {
        courseId: lessonForm.courseId,
        title: lessonForm.title,
        description: lessonForm.description,
        url: lessonForm.url,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setLessonDialogOpen(false);
      toast({ title: editingLesson ? "Lesson updated" : "Lesson added" });
    },
    onError: (e: Error) => toast({ title: "Could not save lesson", description: e.message, variant: "destructive" }),
  });

  const deleteLessonMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/videos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Lesson deleted" });
    },
  });

  const grantMutation = useMutation({
    mutationFn: (partnerId: number) => apiRequest("POST", `/api/admin/courses/${grantsOpen!.id}/grants`, { partnerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/courses", grantsOpen?.id, "grants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setSelectedPartner("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/course-grants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/courses", grantsOpen?.id, "grants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
    },
  });

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage education courses, lessons, access grants, and purchases.</p>
        <Button size="sm" onClick={openCreateCourse} data-testid="button-add-course">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add course
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : !courses || courses.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No courses yet" description="Add your first course." />
      ) : (
        <div className="flex flex-col gap-4">
          {courses.map((c) => (
            <Card key={c.id} data-testid={`card-admin-course-${c.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-base font-semibold">{c.name}</p>
                    {c.description && <p className="text-xs text-muted-foreground mt-1">{c.description}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate">
                        {ACCESS_LABELS[c.accessType] || c.accessType}
                      </Badge>
                      {c.accessType === "paid" && c.priceCents != null && (
                        <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate">
                          {formatPrice(c.priceCents, c.currency)}
                        </Badge>
                      )}
                      {c.learndashCourseId != null && (
                        <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate" data-testid={`badge-learndash-${c.id}`}>
                          LearnDash linked
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{c.lessonCount} lessons</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openEditCourse(c)} data-testid={`button-edit-course-${c.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteCourseMutation.mutate(c.id)} data-testid={`button-delete-course-${c.id}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col divide-y divide-border rounded-md border">
                  {c.lessons.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 p-2.5" data-testid={`row-lesson-${v.id}`}>
                      {v.hasVideo ? (
                        <PlayCircle className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <PlayCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug">{v.title}</p>
                        {!v.hasVideo && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5" data-testid={`badge-no-link-${v.id}`}>
                            <AlertCircle className="h-3 w-3" /> No video link yet — add one
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => openEditLesson(v)} data-testid={`button-edit-lesson-${v.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteLessonMutation.mutate(v.id)} data-testid={`button-delete-lesson-${v.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openCreateLesson(c.id)} data-testid={`button-add-lesson-${c.id}`}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add lesson
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setGrantsOpen(c)} data-testid={`button-manage-access-${c.id}`}>
                    <Users className="h-3.5 w-3.5 mr-1.5" /> Manage access
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Purchase history */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Purchase history</h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm" data-testid="table-purchases">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Partner</th>
                  <th className="p-3 font-medium">Course</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {!purchases || purchases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground" data-testid="text-no-purchases">
                      No purchases yet.
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => (
                    <tr key={p.id} className="border-b last:border-0" data-testid={`row-purchase-${p.id}`}>
                      <td className="p-3">
                        <div>{p.partnerName}</div>
                        <div className="text-xs text-muted-foreground">{p.partnerEmail}</div>
                      </td>
                      <td className="p-3">{p.courseName}</td>
                      <td className="p-3">{formatPrice(p.amountCents, p.currency)}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate">{p.status}</Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Course dialog */}
      <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
        <DialogContent data-testid="dialog-course-form">
          <DialogHeader>
            <DialogTitle>{editingCourse ? "Edit course" : "Add course"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} data-testid="input-course-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-desc">Description</Label>
              <Textarea id="c-desc" rows={2} value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} data-testid="textarea-course-description" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Access type</Label>
              <Select value={courseForm.accessType} onValueChange={(v) => setCourseForm({ ...courseForm, accessType: v })}>
                <SelectTrigger data-testid="select-course-access">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Free — open (no enrollment)</SelectItem>
                  <SelectItem value="enroll">Free — one-click enroll</SelectItem>
                  <SelectItem value="paid">Paid — single unlock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {courseForm.accessType === "paid" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-price">Price (EUR)</Label>
                <Input id="c-price" type="number" step="0.01" value={courseForm.priceEur} onChange={(e) => setCourseForm({ ...courseForm, priceEur: e.target.value })} data-testid="input-course-price" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>LearnDash course (optional)</Label>
              <Select
                value={courseForm.learndashCourseId || "none"}
                onValueChange={(v) => setCourseForm({ ...courseForm, learndashCourseId: v === "none" ? "" : v })}
              >
                <SelectTrigger data-testid="select-course-learndash">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — not linked</SelectItem>
                  {learndash?.courses.map((lc) => (
                    <SelectItem key={lc.id} value={String(lc.id)}>{lc.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {learndash?.configured === false
                  ? "LearnDash is not connected."
                  : learndash?.error
                    ? "Could not load LearnDash courses right now."
                    : "When linked, purchasing, enrolling, or granting access to this course also enrolls the partner in the matching LearnDash course on partner.maha.clinic."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveCourseMutation.mutate()} disabled={saveCourseMutation.isPending} data-testid="button-save-course">
              {saveCourseMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lesson dialog */}
      <Dialog open={lessonDialogOpen} onOpenChange={setLessonDialogOpen}>
        <DialogContent data-testid="dialog-lesson-form">
          <DialogHeader>
            <DialogTitle>{editingLesson ? "Edit lesson" : "Add lesson"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Course</Label>
              <Select value={String(lessonForm.courseId)} onValueChange={(v) => setLessonForm({ ...lessonForm, courseId: Number(v) })}>
                <SelectTrigger data-testid="select-lesson-course">
                  <SelectValue placeholder="Select course..." />
                </SelectTrigger>
                <SelectContent>
                  {courses?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="l-title">Title</Label>
              <Input id="l-title" value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} data-testid="input-lesson-title" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="l-desc">Description</Label>
              <Textarea id="l-desc" rows={2} value={lessonForm.description} onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })} data-testid="textarea-lesson-description" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="l-url">Video link (optional)</Label>
              <Input id="l-url" value={lessonForm.url} onChange={(e) => setLessonForm({ ...lessonForm, url: e.target.value })} placeholder={lessonUrlLoading ? "Loading current link…" : "Add the video URL when available"} disabled={lessonUrlLoading} data-testid="input-lesson-url" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveLessonMutation.mutate()} disabled={saveLessonMutation.isPending || !lessonForm.courseId} data-testid="button-save-lesson">
              {saveLessonMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grants dialog */}
      <Dialog open={!!grantsOpen} onOpenChange={(open) => !open && setGrantsOpen(null)}>
        <DialogContent data-testid="dialog-course-grants">
          <DialogHeader>
            <DialogTitle>Access grants — {grantsOpen?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Manually comp a partner into this course (e.g. VIP partners) without payment.
            </p>
            <div className="flex gap-2">
              <Select value={selectedPartner} onValueChange={setSelectedPartner}>
                <SelectTrigger className="flex-1" data-testid="select-grant-partner">
                  <SelectValue placeholder="Select partner..." />
                </SelectTrigger>
                <SelectContent>
                  {partners?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!selectedPartner} onClick={() => grantMutation.mutate(Number(selectedPartner))} data-testid="button-grant-access">
                Grant
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {grants?.length === 0 && <p className="text-sm text-muted-foreground">No partners have been granted access yet.</p>}
              {grants?.map((g) => (
                <div key={g.id} className="flex items-center justify-between text-sm bg-muted rounded-md px-3 py-2" data-testid={`row-grant-${g.id}`}>
                  <span>{g.partnerName} ({g.partnerEmail})</span>
                  <Button size="icon" variant="ghost" onClick={() => revokeMutation.mutate(g.id)} data-testid={`button-revoke-grant-${g.id}`}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
