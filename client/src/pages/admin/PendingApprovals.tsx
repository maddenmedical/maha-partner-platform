import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { openAuthedFile } from "@/lib/fileAccess";
import { UserCheck, Check, X, ExternalLink, FileText } from "lucide-react";
import { format } from "date-fns";

export default function PendingApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: pending, isLoading } = useQuery<User[]>({ queryKey: ["/api/admin/pending-users"] });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/users/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-users"] });
      toast({ title: "Status updated" });
    },
  });

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <p className="text-sm text-muted-foreground">Review new partner and student registrations before they can log in.</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-32 rounded-lg skeleton-shimmer" />
        </div>
      ) : !pending || pending.length === 0 ? (
        <EmptyState icon={UserCheck} title="All caught up" description="There are no pending registrations to review right now." />
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((u) => (
            <Card key={u.id} data-testid={`card-pending-user-${u.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground break-words">{u.email} · {u.phone}</p>
                    <p className="text-xs text-muted-foreground capitalize mt-0.5">{u.role}{u.businessName ? ` · ${u.businessName}` : ""}{u.profession ? ` · ${u.profession}` : ""}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">Registered {format(new Date(u.createdAt), "MMM d, yyyy")}</p>
                  </div>
                  <div className="flex gap-2 shrink-0 w-full sm:w-auto">
                    <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => mutation.mutate({ id: u.id, status: "rejected" })} data-testid={`button-reject-${u.id}`}>
                      <X className="h-3.5 w-3.5 mr-1.5" /> Reject
                    </Button>
                    <Button size="sm" className="flex-1 sm:flex-none" onClick={() => mutation.mutate({ id: u.id, status: "approved" })} data-testid={`button-approve-${u.id}`}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs border-t border-border pt-3">
                  {u.vatNumber && <span className="text-muted-foreground">VAT: {u.vatNumber}</span>}
                  {u.homepageUrl && (
                    <a href={u.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-primary flex items-center gap-1" data-testid={`link-homepage-${u.id}`}>
                      <ExternalLink className="h-3 w-3" /> Homepage
                    </a>
                  )}
                  {u.degreeFileUrl && (
                    <button
                      type="button"
                      onClick={() => openAuthedFile(u.degreeFileUrl!).catch((e) => toast({ title: "Could not open document", description: e.message, variant: "destructive" }))}
                      className="text-primary flex items-center gap-1"
                      data-testid={`link-document-${u.id}`}
                    >
                      <FileText className="h-3 w-3" /> View document
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
