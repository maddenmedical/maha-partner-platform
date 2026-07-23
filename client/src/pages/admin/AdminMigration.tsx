import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, KeyRound, Check, Copy, RefreshCcw } from "lucide-react";
import { format } from "date-fns";

type MigratedUser = {
  id: number;
  name: string;
  email: string;
  username: string | null;
  password: string | null;
  wpUserId: number | null;
  createdAt: number;
};

type ImportSummary = {
  wpUsersTotal: number;
  partnerUsersTotal: number;
  usersCreated: number;
  usersAlreadyPresent: number;
  courseGrantsCreated: number;
  legacyOrdersImported: number;
  newlyCreatedEmails: string[];
};

export default function AdminMigration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);

  const { data: migrated, isLoading } = useQuery<MigratedUser[]>({
    queryKey: ["/api/admin/migrated-users"],
  });

  const runImport = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/migrate-legacy-partners", {}),
    onSuccess: (data: any) => {
      setLastSummary(data.summary);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migrated-users"] });
      toast({ title: "Import complete", description: `${data.summary.usersCreated} new account(s) created.` });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const markIssued = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/migrated-users/${id}/mark-issued`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migrated-users"] });
      toast({ title: "Marked as issued", description: "The password has been cleared from this view." });
    },
  });

  function copyCreds(u: MigratedUser) {
    const text = `Email: ${u.email}\nPassword: ${u.password}`;
    navigator.clipboard?.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <Card>
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Import from partner.maha.clinic</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Pulls every existing partner account (plus their WooCommerce order history and LearnDash course
            access) from the old WordPress site into this app. Safe to run more than once — accounts already
            migrated are skipped. No emails or push notifications are ever sent by this.
          </p>
          <div>
            <Button size="sm" onClick={() => runImport.mutate()} disabled={runImport.isPending} data-testid="button-run-migration">
              {runImport.isPending ? (
                <>
                  <RefreshCcw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Importing… this can take a couple of minutes
                </>
              ) : (
                <>
                  <UploadCloud className="h-3.5 w-3.5 mr-1.5" /> Run import now
                </>
              )}
            </Button>
          </div>
          {lastSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs border-t border-border pt-3 mt-1" data-testid="text-import-summary">
              <div><span className="text-muted-foreground">WP accounts checked:</span> {lastSummary.partnerUsersTotal}</div>
              <div><span className="text-muted-foreground">New accounts:</span> {lastSummary.usersCreated}</div>
              <div><span className="text-muted-foreground">Already present:</span> {lastSummary.usersAlreadyPresent}</div>
              <div><span className="text-muted-foreground">Course grants:</span> {lastSummary.courseGrantsCreated}</div>
              <div><span className="text-muted-foreground">Legacy orders:</span> {lastSummary.legacyOrdersImported}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <p className="text-sm font-medium mb-1">Credentials awaiting handout</p>
        <p className="text-xs text-muted-foreground">
          These accounts were migrated but haven't been marked as issued yet. Copy the credentials to hand them
          out yourself, then mark as issued to clear the password from this view.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-20 rounded-lg skeleton-shimmer" />
        </div>
      ) : !migrated || migrated.length === 0 ? (
        <EmptyState icon={KeyRound} title="Nothing pending" description="Every migrated account has had its credentials marked as issued." />
      ) : (
        <div className="flex flex-col gap-3">
          {migrated.map((u) => (
            <Card key={u.id} data-testid={`card-migrated-user-${u.id}`}>
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground break-words">{u.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="font-mono text-xs" data-testid={`text-password-${u.id}`}>
                      {u.password}
                    </Badge>
                    <p className="text-xs text-muted-foreground/70">Migrated {format(new Date(u.createdAt), "MMM d, yyyy")}</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 w-full sm:w-auto">
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => copyCreds(u)} data-testid={`button-copy-${u.id}`}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                  </Button>
                  <Button size="sm" className="flex-1 sm:flex-none" onClick={() => markIssued.mutate(u.id)} data-testid={`button-mark-issued-${u.id}`}>
                    <Check className="h-3.5 w-3.5 mr-1.5" /> Mark issued
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
