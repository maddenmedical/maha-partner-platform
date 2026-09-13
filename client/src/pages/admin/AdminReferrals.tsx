import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Referral } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Inbox, FileText, MessageSquare, MoreVertical, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { openAuthedFile } from "@/lib/fileAccess";
import { setPendingThreadId } from "@/lib/chatNav";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type ReferralWithPartner = Referral & { partnerName?: string; partnerEmail?: string; partnerPhone?: string; chatThreadId?: number | null };

const STATUS_OPTIONS = ["New", "Contacted", "Scheduled", "Closed"];
type Scope = "active" | "archived" | "all";

export default function AdminReferrals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [scope, setScope] = useState<Scope>("active");
  const [selected, setSelected] = useState<ReferralWithPartner | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Scope maps to the server's `archived` query param. Active is the default
  // and matches the unparameterized query the admin sidebar uses for its
  // "New" badge, so both stay in sync via a single query key.
  const scopeParam = scope === "active" ? undefined : scope === "archived" ? "true" : "all";
  const listKey = scopeParam
    ? ["/api/admin/referrals", { archived: scopeParam }] as const
    : ["/api/admin/referrals"] as const;

  const { data: referrals, isLoading } = useQuery<ReferralWithPartner[]>({ queryKey: listKey });
  const [, navigate] = useLocation();

  function openReferralChat(threadId: number) {
    setPendingThreadId(threadId);
    navigate("/admin/chat");
  }

  // Invalidate every referral list variant so the sidebar badge, the active
  // tab, and the archived tab all refresh after any mutation.
  function invalidateReferrals() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] });
  }

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/referrals/${id}/status`, { status }),
    onSuccess: invalidateReferrals,
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      apiRequest("PATCH", `/api/admin/referrals/${id}/archive`, { archived }),
    onSuccess: (_data, vars) => {
      invalidateReferrals();
      toast({ title: vars.archived ? "Referral archived" : "Referral unarchived" });
    },
    onError: (e: any) => toast({ title: "Could not update referral", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/referrals/${id}`),
    onSuccess: () => {
      invalidateReferrals();
      // Deleting a referral unlinks its chat thread; refresh chat lists too.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      toast({ title: "Referral deleted" });
      setSelected(null);
      setDeleteId(null);
    },
    onError: (e: any) => {
      toast({ title: "Could not delete referral", description: e?.message, variant: "destructive" });
      setDeleteId(null);
    },
  });

  const filtered = referrals?.filter((r) => filter === "all" || r.status === filter) || [];
  const deletingReferral = deleteId != null ? referrals?.find((r) => r.id === deleteId) : null;

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">All patient referrals submitted by partner clinics.</p>
        <div className="flex items-center gap-2">
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <SelectTrigger className="w-40" data-testid="select-filter-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="all">All referrals</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40" data-testid="select-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Inbox} title="No referrals" description="No referrals match this filter yet." />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Urgency</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Chat</th>
                  <th className="px-4 py-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-border last:border-0 hover-elevate active-elevate-2 cursor-pointer",
                      r.status === "New" && !r.archivedAt && "bg-chart-4/5",
                      r.archivedAt && "opacity-60"
                    )}
                    onClick={() => setSelected(r)}
                    data-testid={`row-referral-${r.id}`}
                  >
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        {r.status === "New" && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-referral-${r.id}`} />}
                        {r.patientFirstName} {r.patientLastName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.partnerName}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.urgency} /></td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{format(new Date(r.createdAt), "MMM d, yyyy")}</td>
                    <td className="px-4 py-3">
                      <div onClick={(e) => e.stopPropagation()}>
                        <Select value={r.status} onValueChange={(v) => mutation.mutate({ id: r.id, status: v })}>
                          <SelectTrigger className="w-32 h-8" data-testid={`select-status-${r.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {r.chatThreadId ? (
                        <button
                          type="button"
                          onClick={() => openReferralChat(r.chatThreadId!)}
                          className="text-primary flex items-center gap-1 text-xs"
                          data-testid={`link-open-chat-${r.id}`}
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Open
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Referral actions"
                            data-testid={`button-referral-menu-${r.id}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {r.archivedAt ? (
                            <DropdownMenuItem
                              onSelect={() => archiveMutation.mutate({ id: r.id, archived: false })}
                              data-testid={`menu-unarchive-referral-${r.id}`}
                            >
                              <ArchiveRestore className="h-4 w-4 mr-2" /> Unarchive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => archiveMutation.mutate({ id: r.id, archived: true })}
                              data-testid={`menu-archive-referral-${r.id}`}
                            >
                              <Archive className="h-4 w-4 mr-2" /> Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteId(r.id)}
                            data-testid={`menu-delete-referral-${r.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent data-testid="dialog-delete-referral">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this referral?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingReferral ? (
                <>
                  This permanently removes the referral for{" "}
                  <span className="font-medium">{deletingReferral.patientFirstName} {deletingReferral.patientLastName}</span>{" "}
                  and cannot be undone.
                  {deletingReferral.chatThreadId ? (
                    <> The linked patient chat will be kept but unlinked from this referral.</>
                  ) : null}
                  {" "}If you might need it later, archive it instead.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-referral">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId != null && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete-referral"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="dialog-referral-detail">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.patientFirstName} {selected.patientLastName}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Partner</p>
                  <p>{selected.partnerName} · {selected.partnerEmail} · {selected.partnerPhone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Patient contact</p>
                  <p>{selected.patientContact}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Case description</p>
                  <p>{selected.caseDescription}</p>
                </div>
                {selected.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                    <p>{selected.notes}</p>
                  </div>
                )}
                {selected.attachmentUrl && (
                  <button
                    type="button"
                    onClick={() => openAuthedFile(selected.attachmentUrl!).catch((e) => toast({ title: "Could not open attachment", description: e.message, variant: "destructive" }))}
                    className="text-primary flex items-center gap-1.5 text-sm"
                    data-testid="link-referral-attachment"
                  >
                    <FileText className="h-4 w-4" /> View attachment
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
