import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClipboardPlus, Link2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface ReferralOption {
  id: number;
  patientFirstName: string;
  patientLastName: string;
}

interface ThreadLike {
  id: number;
  referralId: number | null;
  pendingReferralRequestedAt: number | null;
  pendingReferralRequestedByRole: string | null;
}

interface MergePreview {
  id: number;
  topic: string;
  messageCount: number;
  lastMessage?: string;
  lastMessageAt?: number;
}

interface ReferralLinkPanelProps {
  thread: ThreadLike;
  role: "partner" | "student" | "admin";
  basePath: "/api/chat" | "/api/admin/chat";
  threadsQueryKey: unknown[];
  unlinkedReferrals: ReferralOption[];
  onCreateReferralClick: () => void;
  onThreadChanged: (result?: { thread?: unknown; merged?: boolean; survivingThreadId?: number }) => void;
}

// Handles both "request a referral" (admin flags intent, partner fills in
// later) and "link to an existing referral" (with the merge-confirmation
// flow when the target referral already has its own dedicated chat with
// content). Rendered inline above the message list whenever the thread
// isn't already linked to a referral.
export function ReferralLinkPanel({
  thread, role, basePath, threadsQueryKey, unlinkedReferrals, onCreateReferralClick, onThreadChanged,
}: ReferralLinkPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mergePrompt, setMergePrompt] = useState<{ referralId: number; existingThread: MergePreview } | null>(null);
  const [linking, setLinking] = useState(false);

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${basePath}/threads/${thread.id}/request-referral`, {});
      return res.json();
    },
    onSuccess: (thread) => {
      queryClient.invalidateQueries({ queryKey: threadsQueryKey });
      onThreadChanged({ thread });
      toast({ title: "Referral requested", description: "The partner will be prompted to fill in the form." });
    },
    onError: (e: any) => toast({ title: "Could not request referral", description: e.message, variant: "destructive" }),
  });

  async function submitLink(referralId: number, confirmMerge: boolean) {
    setLinking(true);
    try {
      const res = await fetch(`${API_BASE}${basePath}/threads/${thread.id}/link-referral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ referralId, confirmMerge }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.mergeRequired) {
        setMergePrompt({ referralId, existingThread: data.existingThread });
        return;
      }
      if (!res.ok) throw new Error(data.message || "Could not link referral");
      setMergePrompt(null);
      queryClient.invalidateQueries({ queryKey: threadsQueryKey });
      onThreadChanged(data);
      toast({ title: data.merged ? "Chats merged" : "Chat linked to referral" });
    } catch (e: any) {
      toast({ title: "Could not link referral", description: e.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  }

  function handleSelectReferral(value: string) {
    if (value === "__new__") {
      onCreateReferralClick();
      return;
    }
    submitLink(Number(value), false);
  }

  if (thread.referralId) return null;

  const pendingByOther = thread.pendingReferralRequestedAt && role === "admin";
  const pendingForMe = thread.pendingReferralRequestedAt && role !== "admin";

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm" data-testid="panel-referral-link">
        {pendingForMe && (
          <p className="text-xs text-muted-foreground" data-testid="text-referral-pending-banner">
            The MAHA team requested a patient referral for this chat. Fill in the short form to get started.
          </p>
        )}
        {pendingByOther && (
          <p className="text-xs text-muted-foreground" data-testid="text-referral-pending-admin">
            Referral requested — waiting for the partner to fill in the form.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {role !== "admin" ? (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onCreateReferralClick} data-testid="button-create-referral">
              <ClipboardPlus className="h-3.5 w-3.5" /> {pendingForMe ? "Fill in referral form" : "Create patient referral"}
            </Button>
          ) : (
            !thread.pendingReferralRequestedAt && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => requestMutation.mutate()}
                disabled={requestMutation.isPending}
                data-testid="button-request-referral"
              >
                {requestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPlus className="h-3.5 w-3.5" />}
                Request patient referral
              </Button>
            )
          )}
          <Select onValueChange={handleSelectReferral} disabled={linking}>
            <SelectTrigger className="h-8 w-56 text-xs gap-1.5" data-testid="select-link-referral">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="Link to existing referral" />
            </SelectTrigger>
            <SelectContent>
              {unlinkedReferrals.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.patientFirstName} {r.patientLastName}</SelectItem>
              ))}
              {role !== "admin" && <SelectItem value="__new__">+ Create new referral</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>

      <AlertDialog open={!!mergePrompt} onOpenChange={(open) => !open && setMergePrompt(null)}>
        <AlertDialogContent data-testid="dialog-merge-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Merge this chat with existing patient referral chat?</AlertDialogTitle>
            <AlertDialogDescription>
              That referral already has its own chat ("{mergePrompt?.existingThread.topic}") with{" "}
              {mergePrompt?.existingThread.messageCount} message{mergePrompt?.existingThread.messageCount === 1 ? "" : "s"}.
              Merging will combine both conversations in chronological order into one chat, and this current chat will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-merge">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => mergePrompt && submitLink(mergePrompt.referralId, true)}
              data-testid="button-confirm-merge"
            >
              Merge chats
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
