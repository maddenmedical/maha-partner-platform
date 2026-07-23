import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { ScanFace, Trash2, Loader2, Smartphone } from "lucide-react";
import { format } from "date-fns";
import {
  browserSupportsWebAuthn, registerPasskey, deletePasskey, type WebauthnCredentialSummary,
} from "@/lib/webauthn";

// Account settings shared across all roles (partner, student, admin). Only
// section so far: manage Face ID / Fingerprint (WebAuthn passkeys).
export default function Account() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

  const { data: credentials, isLoading } = useQuery<WebauthnCredentialSummary[]>({
    queryKey: ["/api/webauthn/credentials"],
  });

  async function handleRegister() {
    setRegistering(true);
    try {
      await registerPasskey();
      await queryClient.invalidateQueries({ queryKey: ["/api/webauthn/credentials"] });
      toast({ title: "Face ID / Fingerprint set up", description: "You can now use it to sign in on this device." });
    } catch (err: any) {
      if (err?.name !== "NotAllowedError") {
        toast({ title: "Could not set up Face ID / Fingerprint", description: err.message, variant: "destructive" });
      }
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deletePasskey(id);
      await queryClient.invalidateQueries({ queryKey: ["/api/webauthn/credentials"] });
      toast({ title: "Device removed" });
    } catch (err: any) {
      toast({ title: "Could not remove device", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-account-title">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Signed in as {user?.name} ({user?.email})
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <ScanFace className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">Face ID / Fingerprint sign-in</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sign in faster on this device using Face ID, Touch ID, or your fingerprint — no password needed.
              </p>
            </div>
          </div>

          {!passkeySupported ? (
            <p className="text-sm text-muted-foreground" data-testid="text-passkey-unsupported">
              This browser or device doesn't support Face ID / Fingerprint sign-in.
            </p>
          ) : (
            <>
              {isLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-14 rounded-lg skeleton-shimmer" />
                </div>
              ) : !credentials || credentials.length === 0 ? (
                <EmptyState
                  icon={ScanFace}
                  title="No devices set up yet"
                  description="Register this device to sign in without a password next time."
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {credentials.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                      data-testid={`row-passkey-${c.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" data-testid={`text-passkey-label-${c.id}`}>{c.label}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {format(new Date(c.createdAt), "MMM d, yyyy")}
                            {c.lastUsedAt ? ` · Last used ${format(new Date(c.lastUsedAt), "MMM d, yyyy")}` : ""}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deletingId === c.id}
                        onClick={() => handleDelete(c.id)}
                        aria-label={`Remove ${c.label}`}
                        data-testid={`button-delete-passkey-${c.id}`}
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                disabled={registering}
                onClick={handleRegister}
                data-testid="button-register-passkey"
              >
                {registering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ScanFace className="h-4 w-4 mr-2" />}
                Set up Face ID / Fingerprint on this device
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
