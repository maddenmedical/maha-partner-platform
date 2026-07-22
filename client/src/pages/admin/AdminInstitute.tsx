import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Module, Cohort, ClassSession, User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { openAuthedFile } from "@/lib/fileAccess";
import { GraduationCap, Plus, Trash2, Loader2, FileText, ExternalLink } from "lucide-react";
import { format } from "date-fns";

type HomeworkWithNames = { id: number; classSessionId: number; studentId: number; fileUrl: string; comment: string | null; studentName?: string; sessionTitle?: string; createdAt: number };
type EnrollmentWithNames = { id: number; cohortId: number; studentId: number; studentName?: string; studentEmail?: string; cohortName?: string };

export default function AdminInstitute() {
  return (
    <div className="max-w-5xl">
      <p className="text-sm text-muted-foreground mb-4">Manage Institute modules, cohorts, class sessions, enrollments, and homework review.</p>
      <Tabs defaultValue="modules">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="modules" data-testid="tab-modules">Modules &amp; Cohorts</TabsTrigger>
          <TabsTrigger value="sessions" data-testid="tab-sessions">Class Sessions</TabsTrigger>
          <TabsTrigger value="enrollments" data-testid="tab-enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="homework" data-testid="tab-homework">Homework Review</TabsTrigger>
        </TabsList>
        <TabsContent value="modules" className="mt-4"><ModulesTab /></TabsContent>
        <TabsContent value="sessions" className="mt-4"><SessionsTab /></TabsContent>
        <TabsContent value="enrollments" className="mt-4"><EnrollmentsTab /></TabsContent>
        <TabsContent value="homework" className="mt-4"><HomeworkTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ModulesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: modules, isLoading } = useQuery<Module[]>({ queryKey: ["/api/modules"] });
  const { data: cohorts } = useQuery<Cohort[]>({ queryKey: ["/api/cohorts"] });
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [moduleForm, setModuleForm] = useState({ name: "", description: "" });
  const [cohortDialogOpen, setCohortDialogOpen] = useState<number | null>(null);
  const [cohortName, setCohortName] = useState("");

  const createModule = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/modules", moduleForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/modules"] });
      setModuleDialogOpen(false);
      setModuleForm({ name: "", description: "" });
      toast({ title: "Module created" });
    },
  });
  const deleteModule = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/modules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/modules"] }),
  });
  const createCohort = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/cohorts", { moduleId: cohortDialogOpen, name: cohortName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cohorts"] });
      setCohortDialogOpen(null);
      setCohortName("");
      toast({ title: "Cohort created" });
    },
  });
  const deleteCohort = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/cohorts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cohorts"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" className="self-start" onClick={() => setModuleDialogOpen(true)} data-testid="button-add-module">
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add module
      </Button>

      {isLoading ? (
        <Skeleton className="h-48 rounded-lg skeleton-shimmer" />
      ) : !modules || modules.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No modules yet" description="Create your first Institute module." />
      ) : (
        <div className="flex flex-col gap-3">
          {modules.map((m) => (
            <Card key={m.id} data-testid={`card-module-${m.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteModule.mutate(m.id)} data-testid={`button-delete-module-${m.id}`}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                <div className="border-t border-border pt-2 flex flex-col gap-1.5">
                  {cohorts?.filter((c) => c.moduleId === m.id).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm bg-muted rounded-md px-3 py-1.5" data-testid={`row-cohort-${c.id}`}>
                      <span>{c.name}</span>
                      <Button size="icon" variant="ghost" onClick={() => deleteCohort.mutate(c.id)} data-testid={`button-delete-cohort-${c.id}`}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="self-start mt-1" onClick={() => setCohortDialogOpen(m.id)} data-testid={`button-add-cohort-${m.id}`}>
                    <Plus className="h-3 w-3 mr-1" /> Add cohort
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <DialogContent data-testid="dialog-module-form">
          <DialogHeader><DialogTitle>Add module</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-name">Name</Label>
              <Input id="m-name" value={moduleForm.name} onChange={(e) => setModuleForm({ ...moduleForm, name: e.target.value })} data-testid="input-module-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-desc">Description</Label>
              <Textarea id="m-desc" rows={3} value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} data-testid="textarea-module-description" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createModule.mutate()} disabled={createModule.isPending} data-testid="button-save-module">
              {createModule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cohortDialogOpen} onOpenChange={(open) => !open && setCohortDialogOpen(null)}>
        <DialogContent data-testid="dialog-cohort-form">
          <DialogHeader><DialogTitle>Add cohort</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-name">Cohort name</Label>
            <Input id="c-name" value={cohortName} onChange={(e) => setCohortName(e.target.value)} data-testid="input-cohort-name" />
          </div>
          <DialogFooter>
            <Button onClick={() => createCohort.mutate()} disabled={createCohort.isPending} data-testid="button-save-cohort">
              {createCohort.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useQuery<ClassSession[]>({ queryKey: ["/api/class-sessions"] });
  const { data: cohorts } = useQuery<Cohort[]>({ queryKey: ["/api/cohorts"] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ cohortId: "", title: "", datetime: "", zoomLink: "https://zoom.us/j/0000000000", notes: "" });

  const createSession = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/class-sessions", {
        cohortId: Number(form.cohortId),
        title: form.title,
        datetime: new Date(form.datetime).getTime(),
        zoomLink: form.zoomLink,
        notes: form.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/class-sessions"] });
      setDialogOpen(false);
      setForm({ cohortId: "", title: "", datetime: "", zoomLink: "https://zoom.us/j/0000000000", notes: "" });
      toast({ title: "Class session created" });
    },
  });
  const deleteSession = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/class-sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/class-sessions"] }),
  });

  const sorted = [...(sessions || [])].sort((a, b) => a.datetime - b.datetime);

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" className="self-start" onClick={() => setDialogOpen(true)} data-testid="button-add-session">
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add class session
      </Button>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : sorted.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No class sessions" description="Add a class session to a cohort." />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Cohort</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Zoom</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0" data-testid={`row-session-${s.id}`}>
                    <td className="px-4 py-3">{s.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cohorts?.find((c) => c.id === s.cohortId)?.name}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{format(new Date(s.datetime), "MMM d, yyyy HH:mm")}</td>
                    <td className="px-4 py-3">
                      <a href={s.zoomLink} target="_blank" rel="noopener noreferrer" className="text-primary flex items-center gap-1">
                        <ExternalLink className="h-3.5 w-3.5" /> Link
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Button size="icon" variant="ghost" onClick={() => deleteSession.mutate(s.id)} data-testid={`button-delete-session-${s.id}`}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-session-form">
          <DialogHeader><DialogTitle>Add class session</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Cohort</Label>
              <Select value={form.cohortId} onValueChange={(v) => setForm({ ...form, cohortId: v })}>
                <SelectTrigger data-testid="select-session-cohort"><SelectValue placeholder="Select cohort..." /></SelectTrigger>
                <SelectContent>
                  {cohorts?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-title">Title</Label>
              <Input id="s-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-session-title" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-datetime">Date &amp; time</Label>
              <Input id="s-datetime" type="datetime-local" value={form.datetime} onChange={(e) => setForm({ ...form, datetime: e.target.value })} data-testid="input-session-datetime" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-zoom">Zoom link</Label>
              <Input id="s-zoom" value={form.zoomLink} onChange={(e) => setForm({ ...form, zoomLink: e.target.value })} data-testid="input-session-zoom" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-notes">Notes</Label>
              <Textarea id="s-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="textarea-session-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createSession.mutate()} disabled={createSession.isPending || !form.cohortId} data-testid="button-save-session">
              {createSession.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EnrollmentsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: enrollments, isLoading } = useQuery<EnrollmentWithNames[]>({ queryKey: ["/api/admin/enrollments"] });
  const { data: cohorts } = useQuery<Cohort[]>({ queryKey: ["/api/cohorts"] });
  const { data: students } = useQuery<User[]>({ queryKey: ["/api/admin/students"] });
  const [cohortId, setCohortId] = useState("");
  const [studentId, setStudentId] = useState("");

  const createEnrollment = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/enrollments", { cohortId: Number(cohortId), studentId: Number(studentId) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/enrollments"] });
      setCohortId("");
      setStudentId("");
      toast({ title: "Student enrolled" });
    },
  });
  const deleteEnrollment = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/enrollments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/enrollments"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5 min-w-48">
            <Label>Student</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger data-testid="select-enroll-student"><SelectValue placeholder="Select student..." /></SelectTrigger>
              <SelectContent>
                {students?.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 min-w-48">
            <Label>Cohort</Label>
            <Select value={cohortId} onValueChange={setCohortId}>
              <SelectTrigger data-testid="select-enroll-cohort"><SelectValue placeholder="Select cohort..." /></SelectTrigger>
              <SelectContent>
                {cohorts?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={!cohortId || !studentId || createEnrollment.isPending} onClick={() => createEnrollment.mutate()} data-testid="button-enroll-student">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Enroll
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-40 rounded-lg skeleton-shimmer" />
      ) : !enrollments || enrollments.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No enrollments yet" description="Enroll students into cohorts using the form above." />
      ) : (
        <div className="flex flex-col gap-2">
          {enrollments.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-sm bg-card border border-card-border rounded-md px-4 py-2.5" data-testid={`row-enrollment-${e.id}`}>
              <span>{e.studentName} → {e.cohortName}</span>
              <Button size="icon" variant="ghost" onClick={() => deleteEnrollment.mutate(e.id)} data-testid={`button-delete-enrollment-${e.id}`}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HomeworkTab() {
  const { toast } = useToast();
  const { data: homework, isLoading } = useQuery<HomeworkWithNames[]>({ queryKey: ["/api/admin/homework"] });

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <Skeleton className="h-48 rounded-lg skeleton-shimmer" />
      ) : !homework || homework.length === 0 ? (
        <EmptyState icon={FileText} title="No homework submissions" description="Student homework submissions will appear here." />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Session</th>
                  <th className="px-4 py-3 font-medium">Comment</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">File</th>
                </tr>
              </thead>
              <tbody>
                {homework.map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-0" data-testid={`row-homework-${h.id}`}>
                    <td className="px-4 py-3">{h.studentName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{h.sessionTitle}</td>
                    <td className="px-4 py-3 text-muted-foreground">{h.comment || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{format(new Date(h.createdAt), "MMM d, yyyy")}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openAuthedFile(h.fileUrl).catch((e) => toast({ title: "Could not open file", description: e.message, variant: "destructive" }))}
                        className="text-primary flex items-center gap-1"
                        data-testid={`link-homework-file-${h.id}`}
                      >
                        <FileText className="h-3.5 w-3.5" /> Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
