import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { TierBadge } from "@/components/TierBadge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Building2, Plus, Search, UserPlus, X, Loader2, ChevronsUpDown, Pencil, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ClinicMember = { id: number; name: string; role: string; email: string; standingPoints: number };
type ClinicWithStats = { id: number; name: string; points: number; tierKey: string; tierLabel: string; members: ClinicMember[] };

export default function AdminClinics() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: clinics, isLoading } = useQuery<ClinicWithStats[]>({ queryKey: ["/api/admin/clinics"] });
  const { data: allPartners } = useQuery<User[]>({ queryKey: ["/api/admin/all-partners"] });

  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newClinicName, setNewClinicName] = useState("");
  const [addMemberClinic, setAddMemberClinic] = useState<ClinicWithStats | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ clinic: ClinicWithStats; member: ClinicMember } | null>(null);
  const [editTarget, setEditTarget] = useState<ClinicWithStats | null>(null);
  const [editedName, setEditedName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ClinicWithStats | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  function invalidateClinicData() {
    const prefixes = ["/api/admin/clinics", "/api/admin/all-partners", "/api/admin/standing",
      "/api/standing", "/api/community", "/api/admin/community"];
    queryClient.invalidateQueries({
      predicate: (query) => prefixes.some((prefix) => String(query.queryKey[0]).startsWith(prefix)),
    });
  }

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => apiRequest("PATCH", `/api/admin/clinics/${id}`, { name }),
    onSuccess: () => {
      setEditTarget(null);
      invalidateClinicData();
      toast({ title: "Clinic updated" });
    },
    onError: (err: Error) => toast({ title: "Could not update clinic", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, confirmName }: { id: number; confirmName: string }) => apiRequest("DELETE", `/api/admin/clinics/${id}`, { confirmName }),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteConfirmation("");
      invalidateClinicData();
      toast({ title: "Clinic deleted", description: "Member accounts and their records have been kept." });
    },
    onError: (err: Error) => toast({ title: "Could not delete clinic", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/admin/clinics", { name });
      return res.json();
    },
    onSuccess: () => {
      setCreateOpen(false);
      setNewClinicName("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clinics"] });
      toast({ title: "Clinic created" });
    },
    onError: (err: any) => toast({ title: "Could not create clinic", description: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ userId, clinicId }: { userId: number; clinicId: number | null }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/clinic`, { clinicId });
      return res.json();
    },
    onSuccess: () => {
      setAddMemberClinic(null);
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clinics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/all-partners"] });
    },
    onError: (err: any) => toast({ title: "Could not update clinic membership", description: err.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    if (!clinics) return [];
    const q = query.trim().toLowerCase();
    if (!q) return clinics;
    return clinics.filter((c) => c.name.toLowerCase().includes(q) || c.members.some((m) => m.name.toLowerCase().includes(q)));
  }, [clinics, query]);

  // Anyone not already in the clinic currently being edited -- lets an admin
  // move a member from a mistyped/duplicate clinic into the right one.
  const pickerCandidates = useMemo(() => {
    if (!allPartners || !addMemberClinic) return [];
    return allPartners.filter((u) => u.clinicId !== addMemberClinic.id);
  }, [allPartners, addMemberClinic]);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <p className="text-sm text-muted-foreground">
        Clinics pool Partner Level status across everyone who works there — a clinic's doctors, nurses, and
        administrators all share one status, regardless of who personally submitted a referral or order. Accounts
        join automatically at registration when their business name matches; use "Add member" here for retroactive
        grouping or to fix mismatched business names.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by clinic or member name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-clinics"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-clinic">
          <Plus className="h-4 w-4 mr-1.5" /> New clinic
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-32 rounded-lg skeleton-shimmer" />
        </div>
      ) : !clinics || clinics.length === 0 ? (
        <EmptyState icon={Building2} title="No clinics yet" description="Clinics are created automatically as partners register with a business name, or you can add one manually." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matches" description="Try a different search term." />
      ) : (
        <div className="flex flex-col gap-4" data-testid="list-clinics">
          {filtered.map((c) => (
            <Card key={c.id} data-testid={`card-clinic-${c.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium break-words [overflow-wrap:anywhere]" data-testid={`text-clinic-name-${c.id}`}>{c.name}</p>
                      <TierBadge tierKey={c.tierKey} tierLabel={c.tierLabel} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-clinic-member-count-${c.id}`}>
                      {c.members.length} {c.members.length === 1 ? "member" : "members"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setAddMemberClinic(c)}
                    data-testid={`button-add-member-${c.id}`}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add member
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditTarget(c); setEditedName(c.name); }}
                    data-testid={`button-edit-clinic-${c.id}`} aria-label={`Edit ${c.name}`}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive"
                    onClick={() => { setDeleteTarget(c); setDeleteConfirmation(""); }}
                    data-testid={`button-delete-clinic-${c.id}`} aria-label={`Delete ${c.name}`}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                  </Button>
                  </div>
                </div>
                {c.members.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    {c.members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`row-clinic-member-${m.id}`}>
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="truncate">{m.name}</span>
                          <span className="text-xs text-muted-foreground capitalize shrink-0">{m.role}</span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => setRemoveTarget({ clinic: c, member: m })}
                          data-testid={`button-remove-member-${m.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open && !renameMutation.isPending) setEditTarget(null); }}>
        <DialogContent data-testid="dialog-edit-clinic" className="w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit clinic</DialogTitle>
            <DialogDescription>Rename this clinic without changing its members or their records. Individual profile business names are not changed.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (editTarget && editedName.trim() && !renameMutation.isPending) renameMutation.mutate({ id: editTarget.id, name: editedName.trim() }); }}
            className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-clinic-name">Clinic name</Label>
              <Input id="edit-clinic-name" value={editedName} onChange={(e) => setEditedName(e.target.value)}
                maxLength={120} required disabled={renameMutation.isPending} data-testid="input-edit-clinic-name" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={renameMutation.isPending} onClick={() => setEditTarget(null)} data-testid="button-cancel-edit-clinic">Cancel</Button>
              <Button type="submit" disabled={renameMutation.isPending || !editedName.trim()} data-testid="button-save-clinic">
                {renameMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-delete-clinic" className="w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words [overflow-wrap:anywhere]">Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the clinic grouping. Its members will be unassigned from the clinic and will use their individual Partner Levels.
              Accounts, individual points, referrals, orders, chats and historical records will be kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm" data-testid="text-delete-clinic-members">{deleteTarget?.members.length ?? 0} currently linked members. No member accounts will be deleted.</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-clinic-name">Type the clinic name to confirm</Label>
            <Input id="confirm-clinic-name" value={deleteConfirmation} disabled={deleteMutation.isPending}
              onChange={(e) => setDeleteConfirmation(e.target.value)} autoComplete="off" data-testid="input-confirm-delete-clinic" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending} data-testid="button-cancel-delete-clinic">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id, confirmName: deleteConfirmation }); }}
              disabled={deleteMutation.isPending || deleteConfirmation !== deleteTarget?.name}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-clinic">
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Delete clinic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setNewClinicName(""); }}>
        <DialogContent data-testid="dialog-create-clinic">
          <DialogHeader><DialogTitle>New clinic</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="clinic-name">Clinic name</Label>
            <Input
              id="clinic-name"
              value={newClinicName}
              onChange={(e) => setNewClinicName(e.target.value)}
              placeholder="e.g. Vienna Dental Group"
              data-testid="input-new-clinic-name"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => createMutation.mutate(newClinicName.trim())}
              disabled={createMutation.isPending || !newClinicName.trim()}
              data-testid="button-save-new-clinic"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addMemberClinic} onOpenChange={(open) => { if (!open) { setAddMemberClinic(null); setMemberPickerOpen(false); } }}>
        <DialogContent data-testid="dialog-add-clinic-member">
          <DialogHeader><DialogTitle>Add member to {addMemberClinic?.name}</DialogTitle></DialogHeader>
          <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="justify-between" data-testid="button-open-member-picker">
                Search partners & students…
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[--radix-popover-trigger-width]">
              <Command>
                <CommandInput placeholder="Search by name or email…" data-testid="input-member-picker-search" />
                <CommandList>
                  <CommandEmpty>No matches.</CommandEmpty>
                  <CommandGroup>
                    {pickerCandidates.map((u) => (
                      <CommandItem
                        key={u.id}
                        value={`${u.name} ${u.email}`}
                        onSelect={() => {
                          if (addMemberClinic) assignMutation.mutate({ userId: u.id, clinicId: addMemberClinic.id });
                          setMemberPickerOpen(false);
                        }}
                        data-testid={`option-member-${u.id}`}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{u.name}{u.clinicId ? " (in another clinic)" : ""}</span>
                          <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">
            Selecting an account already in a different clinic moves it here — their points move with them
            immediately.
          </p>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent data-testid="dialog-confirm-remove-member">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.member.name} from {removeTarget?.clinic.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their own points stay on their account, but they'll no longer count toward this clinic's shared status,
              and their status badge will reflect only their individual points going forward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-member">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) assignMutation.mutate({ userId: removeTarget.member.id, clinicId: null });
              }}
              disabled={assignMutation.isPending}
              data-testid="button-confirm-remove-member"
            >
              {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
