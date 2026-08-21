import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { openAuthedFile } from "@/lib/fileAccess";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Contact, Search, ExternalLink, FileText, KeyRound, Copy, Loader2, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

const STATUS_FILTERS = ["all", "pending", "approved", "rejected"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function AdminPartners() {
  const { toast } = useToast();
  const { data: partners, isLoading } = useQuery<User[]>({ queryKey: ["/api/admin/all-partners"] });

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [confirmTarget, setConfirmTarget] = useState<User | null>(null);
  const [result, setResult] = useState<{ name: string; email: string; newPassword: string } | null>(null);

  const resetMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/reset-password`);
      return res.json();
    },
    onSuccess: (data: { id: number; name: string; email: string; newPassword: string }) => {
      setConfirmTarget(null);
      setResult(data);
    },
    onError: (err: any) => {
      toast({ title: "Could not reset password", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!partners) return [];
    const q = query.trim().toLowerCase();
    return partners.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.businessName || "").toLowerCase().includes(q)
      );
    });
  }, [partners, query, statusFilter]);

  function copyPassword() {
    if (!result) return;
    navigator.clipboard?.writeText(result.newPassword);
    toast({ title: "Copied to clipboard" });
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <p className="text-sm text-muted-foreground">
        Every registered partner account, regardless of approval status. Use this to look someone up or reset their
        password if they've forgotten it.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or business…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-partners"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              className="capitalize"
              onClick={() => setStatusFilter(s)}
              data-testid={`button-filter-${s}`}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-28 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-28 rounded-lg skeleton-shimmer" />
        </div>
      ) : !partners || partners.length === 0 ? (
        <EmptyState icon={Contact} title="No partners yet" description="Registered partner accounts will show up here." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matches" description="Try a different search term or status filter." />
      ) : (
        <div className="flex flex-col gap-3" data-testid="list-partners">
          {filtered.map((u) => (
            <Card key={u.id} data-testid={`card-partner-${u.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" data-testid={`text-name-${u.id}`}>{u.name}</p>
                      <StatusBadge status={u.status} />
                    </div>
                    <p className="text-xs text-muted-foreground break-words" data-testid={`text-email-${u.id}`}>
                      {u.email}{u.phone ? ` · ${u.phone}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[u.businessName, u.profession].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      {[u.city, u.country].filter(Boolean).join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      Registered {format(new Date(u.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 w-full sm:w-auto"
                    onClick={() => setConfirmTarget(u)}
                    data-testid={`button-reset-password-${u.id}`}
                  >
                    <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Reset password
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3 text-xs border-t border-border pt-3">
                  {u.vatNumber && <span className="text-muted-foreground">VAT: {u.vatNumber}</span>}
                  {u.address && <span className="text-muted-foreground">Address: {u.address}</span>}
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

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <AlertDialogContent data-testid="dialog-confirm-reset">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password for {confirmTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately replaces their current password with a new random one. You'll see the new password
              on screen so you can relay it yourself — the automatic email to {confirmTarget?.email} is a
              best-effort extra and may not arrive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmTarget) resetMutation.mutate(confirmTarget.id);
              }}
              disabled={resetMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!result} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent data-testid="dialog-reset-result">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" /> Password reset
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              New password for <span className="font-medium text-foreground">{result?.name}</span> ({result?.email}):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted rounded-md px-3 py-2 text-sm font-mono break-all" data-testid="text-new-password">
                {result?.newPassword}
              </code>
              <Button size="sm" variant="outline" onClick={copyPassword} data-testid="button-copy-password">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              We also tried emailing this to the partner, but delivery isn't guaranteed — please relay it to them
              yourself to be safe.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
