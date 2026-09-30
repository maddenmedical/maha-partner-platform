import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings2, Trash2 } from "lucide-react";
import type { AdminRecordKind, AdminRecordPreview } from "@shared/adminRecordControls";
import type { User, Module, Cohort } from "@shared/schema";
import { format } from "date-fns";

type Field = { key: string; label: string; type?: "textarea" | "number" | "datetime" | "select"; nullable?: boolean; options?: { value: string; label: string }[] };
const options = (values: string[]) => values.map(value => ({ value, label: value }));

/** Shared destructive controls. Fetch authoritative values/permissions only when opened. */
export function AdminRecordActions({ kind, id, deleteOnly = false }: { kind: AdminRecordKind; id: number; deleteOnly?: boolean }) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const endpoint = `/api/admin/record-controls/${kind}/${id}`;
  const preview = useQuery<AdminRecordPreview>({
    queryKey: [endpoint], enabled: !!mode, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async () => {
      const data: AdminRecordPreview = await (await apiRequest("GET", endpoint)).json();
      setValues(Object.fromEntries(Object.entries(data.values).map(([k, v]) => [
        k, k === "datetime" && v ? format(new Date(Number(v)), "yyyy-MM-dd'T'HH:mm") : v === null ? "" : String(v),
      ])));
      return data;
    },
  });
  const team = useQuery<User[]>({ queryKey: ["/api/admin/team"], enabled: mode === "edit" && kind === "todo" });
  const modules = useQuery<Module[]>({ queryKey: ["/api/modules"], enabled: mode === "edit" && kind === "cohort" });
  const cohorts = useQuery<Cohort[]>({ queryKey: ["/api/cohorts"], enabled: mode === "edit" && (kind === "class-session" || kind === "enrollment") });
  const cohortOptions = (cohorts.data || []).map(c => ({ value: String(c.id), label: c.name }));
  const fields: Field[] = kind === "order" ? [{ key: "status", label: "Status", type: "select", options: options(["Requested", "Confirmed", "Fulfilled", "Cancelled"]) }]
    : kind === "todo" ? [
      { key: "status", label: "Status", type: "select", options: options(["open", "done"]) },
      { key: "assignedToAdminId", label: "Assigned admin", type: "select", options: (team.data || []).filter(a => !a.archivedAt && a.status === "approved").map(a => ({ value: String(a.id), label: a.name })) },
      ...(preview.data?.canEditText ? [{ key: "note", label: "Your note", type: "textarea" as const }] : []),
    ]
    : kind === "announcement" ? [{ key: "title", label: "Title" }, { key: "body", label: "Message", type: "textarea" }, { key: "url", label: "Destination URL", nullable: true }]
    : kind === "module" ? [{ key: "name", label: "Name" }, { key: "description", label: "Description", type: "textarea", nullable: true }]
    : kind === "cohort" ? [{ key: "name", label: "Name" }, { key: "moduleId", label: "Module", type: "select", options: (modules.data || []).map(m => ({ value: String(m.id), label: m.name })) }]
    : kind === "class-session" ? [{ key: "title", label: "Title" }, { key: "cohortId", label: "Cohort", type: "select", options: cohortOptions }, { key: "datetime", label: "Date and time (your local time)", type: "datetime" }, { key: "zoomLink", label: "Zoom URL" }, { key: "notes", label: "Session notes", type: "textarea", nullable: true }]
    : kind === "enrollment" ? [{ key: "cohortId", label: "Move to cohort", type: "select", options: cohortOptions }]
    : kind === "admin-account" ? [{ key: "archived", label: "Account access", type: "select", options: [{ value: "false", label: "Active" }, { value: "true", label: "Deactivated (no login)" }] }]
    : kind === "price-tier" ? [{ key: "minQty", label: "Minimum quantity", type: "number" }, { key: "maxQty", label: "Maximum quantity (blank = no limit)", type: "number", nullable: true }, { key: "pricePerUnit", label: "Unit price in cents", type: "number" }] : [];
  const pendingOptions = kind === "todo" ? team.isFetching || team.isError
    : kind === "cohort" ? modules.isFetching || modules.isError
    : kind === "class-session" || kind === "enrollment" ? cohorts.isFetching || cohorts.isError : false;
  const change = useMutation({
    mutationFn: async () => {
      if (mode === "delete") return apiRequest("DELETE", endpoint, { confirmation });
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        const value = values[field.key] ?? "";
        if (field.nullable && !value.trim()) patch[field.key] = null;
        else if (field.key === "archived") patch[field.key] = value === "true";
        else if (field.type === "datetime") patch[field.key] = new Date(value).getTime();
        else if (field.type === "number" || field.key.endsWith("Id")) patch[field.key] = value === "" ? null : Number(value);
        else patch[field.key] = value;
      }
      return apiRequest("PATCH", endpoint, patch);
    },
    onSuccess: () => {
      const deleted = mode === "delete";
      setMode(null);
      // Related rows/access can span multiple screens after a cascade.
      qc.invalidateQueries();
      toast({ title: deleted ? "Record deleted" : "Changes saved" });
    },
    onError: (err: Error) => setError(err.message),
  });
  function open(next: "edit" | "delete") {
    setError(""); setConfirmation(""); setValues({}); setMode(next);
  }
  const ready = preview.data && !preview.isFetching && !preview.isError;
  const canSave = ready && preview.data.canEdit && !pendingOptions;
  return <>
    <div className="flex flex-wrap gap-1.5 shrink-0">
      {!deleteOnly && <Button type="button" size="sm" variant="outline" onClick={() => open("edit")} data-testid={`manage-${kind}-${id}`}><Settings2 className="w-3.5 h-3.5 mr-1" />Manage</Button>}
      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => open("delete")} data-testid={`delete-${kind}-${id}`}><Trash2 className="w-3.5 h-3.5 mr-1" />Delete</Button>
    </div>
    <Dialog open={!!mode} onOpenChange={open => { if (!open && !change.isPending) setMode(null); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto" data-testid={`record-dialog-${kind}-${id}`}>
        <DialogHeader>
          <DialogTitle className="break-words">{mode === "delete" ? "Delete" : "Manage"} {preview.data?.label || `${kind} #${id}`}</DialogTitle>
          <DialogDescription>{mode === "delete" ? "Review the impact before permanently deleting this record." : "Only the permitted fields can be changed. Original authorship is preserved."}</DialogDescription>
        </DialogHeader>
        {preview.isFetching ? <p role="status">Loading current details…</p>
          : preview.isError ? <div role="alert" className="text-destructive text-sm"><p>{preview.error.message}</p><Button variant="outline" onClick={() => preview.refetch()}>Retry</Button></div>
          : ready && <div className="space-y-4 min-w-0">
            {mode === "delete" ? <>
              <p className="text-sm">{preview.data.impact}</p>
              {preview.data.blockedReason ? <p role="alert" className="text-sm text-destructive">{preview.data.blockedReason}</p> : <div className="space-y-2">
                <Label htmlFor={`confirm-${kind}-${id}`}>Type DELETE {id} to confirm</Label>
                <Input id={`confirm-${kind}-${id}`} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" />
              </div>}
            </> : !preview.data.canEdit ? <p className="text-sm">You cannot edit this record's text. Use Delete to remove it where permitted.</p> : <>
              {kind === "todo" && !preview.data.canEditText && <p className="text-sm text-muted-foreground">You can reassign or change the status, but cannot rewrite another admin's note.</p>}
              {kind === "announcement" && <p className="text-sm text-muted-foreground">Changes affect stored history only. Already-delivered notifications will not change or be resent.</p>}
              {kind === "admin-account" && <p className="text-sm text-muted-foreground">Deactivation blocks login and ends active sessions. Historical activity stays. {preview.data.blockedReason}</p>}
              {fields.map(field => <div className="space-y-1.5" key={field.key}>
                <Label htmlFor={`record-${kind}-${id}-${field.key}`}>{field.label}</Label>
                {field.type === "select" ? <select id={`record-${kind}-${id}-${field.key}`} className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={values[field.key] ?? ""} onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}>
                  <option value="" disabled>Select…</option>
                  {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select> : field.type === "textarea" ? <Textarea id={`record-${kind}-${id}-${field.key}`} value={values[field.key] ?? ""} onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))} />
                  : <Input id={`record-${kind}-${id}-${field.key}`} type={field.type === "datetime" ? "datetime-local" : field.type === "number" ? "number" : "text"} value={values[field.key] ?? ""} onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))} />}
              </div>)}
              {pendingOptions && <p role="status" className="text-sm text-muted-foreground">Waiting for available choices. If loading fails, close and reopen this dialog.</p>}
            </>}
          </div>}
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={change.isPending} onClick={() => setMode(null)}>Cancel</Button>
          <Button variant={mode === "delete" ? "destructive" : "default"} disabled={change.isPending || (mode === "delete" ? !ready || !preview.data?.canDelete || confirmation !== `DELETE ${id}` : !canSave)} onClick={() => { setError(""); change.mutate(); }} data-testid="confirm-record-action">
            {change.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{mode === "delete" ? "Delete permanently" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
