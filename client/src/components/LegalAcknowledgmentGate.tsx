import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { CURRENT_LEGAL_VERSION } from "@/lib/legalContent";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";

// One-time acknowledgment for accounts created before the Privacy
// Policy/Terms pages existed (or after CURRENT_LEGAL_VERSION is bumped for a
// material change). Blocks the app behind a modal — no dismiss without
// acknowledging — until the user's stored legalAcceptedVersion matches.
// Mount once, high up in the authed app shell (see App.tsx).
export function LegalAcknowledgmentGate() {
  const { user, updateUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const needsAcknowledgment = !!user && user.legalAcceptedVersion !== CURRENT_LEGAL_VERSION;

  async function handleAcknowledge() {
    setSubmitting(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/auth/accept-legal");
      const data = await res.json();
      updateUser({ legalAcceptedVersion: data.user.legalAcceptedVersion });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!needsAcknowledgment) return null;

  return (
    <Dialog open modal onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="dialog-legal-acknowledgment"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-primary" />
            <DialogTitle>Updated Privacy Policy &amp; Terms</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-legal-ack-body">
          We've published a Privacy Policy and Terms of Use for the MAHA Partner Platform. Please review
          them and confirm you've read and agree before continuing.
        </p>
        <div className="flex flex-col gap-1.5 text-sm">
          <a href="#/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2" data-testid="link-ack-privacy">
            Read the Privacy Policy
          </a>
          <a href="#/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2" data-testid="link-ack-terms">
            Read the Terms of Use
          </a>
        </div>
        {error && <p className="text-sm text-destructive" data-testid="text-legal-ack-error">{error}</p>}
        <DialogFooter>
          <Button onClick={handleAcknowledge} disabled={submitting} className="w-full" data-testid="button-acknowledge-legal">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            I have read and agree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
