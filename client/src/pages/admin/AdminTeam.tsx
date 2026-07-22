import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Loader2, Shield } from "lucide-react";

export default function AdminTeam() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: team, isLoading } = useQuery<User[]>({ queryKey: ["/api/admin/team"] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/team", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
      setDialogOpen(false);
      setForm({ name: "", email: "", password: "", phone: "" });
      toast({ title: "Admin account created" });
    },
    onError: (err: any) => {
      toast({ title: "Could not create admin", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Admins share full access to referrals, orders, chat, and Institute management.</p>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="button-add-admin">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add admin
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 rounded-lg skeleton-shimmer" />
      ) : (
        <div className="flex flex-col gap-2">
          {team?.map((t) => (
            <Card key={t.id} data-testid={`card-admin-${t.id}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.email}{t.phone ? ` · ${t.phone}` : ""}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-add-admin">
          <DialogHeader><DialogTitle>Add admin account</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-name">Name</Label>
              <Input id="a-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-admin-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-email">Email</Label>
              <Input id="a-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-admin-email" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-password">Password</Label>
              <Input id="a-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="input-admin-password" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-phone">Phone (optional)</Label>
              <Input id="a-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-admin-phone" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name || !form.email || !form.password} data-testid="button-save-admin">
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
