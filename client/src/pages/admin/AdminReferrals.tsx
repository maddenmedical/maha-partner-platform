import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Referral } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Inbox, FileText } from "lucide-react";
import { openAuthedFile } from "@/lib/fileAccess";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type ReferralWithPartner = Referral & { partnerName?: string; partnerEmail?: string; partnerPhone?: string };

const STATUS_OPTIONS = ["New", "Contacted", "Scheduled", "Closed"];

export default function AdminReferrals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ReferralWithPartner | null>(null);

  const { data: referrals, isLoading } = useQuery<ReferralWithPartner[]>({ queryKey: ["/api/admin/referrals"] });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/referrals/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] }),
  });

  const filtered = referrals?.filter((r) => filter === "all" || r.status === filter) || [];

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">All patient referrals submitted by partner clinics.</p>
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
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-0 hover-elevate active-elevate-2 cursor-pointer"
                    onClick={() => setSelected(r)}
                    data-testid={`row-referral-${r.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{r.patientFirstName} {r.patientLastName}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

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
