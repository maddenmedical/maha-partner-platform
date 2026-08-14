import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { ScanFace, Trash2, Loader2, Smartphone, KeyRound, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import {
  browserSupportsWebAuthn, registerPasskey, deletePasskey, type WebauthnCredentialSummary,
} from "@/lib/webauthn";

// Account settings shared across all roles (partner, student, admin).
// Sections: change password, manage Face ID / Fingerprint (WebAuthn passkeys).
export default function Account() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated", description: "Use your new password next time you sign in." });
    } catch (err: any) {
      setPasswordError(err.message || "Could not change password");
    } finally {
      setChangingPassword(false);
    }
  }

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
            <KeyRound className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">Change password</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Update your password. You'll stay signed in on this device.
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                data-testid="input-current-password"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                data-testid="input-new-password"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                data-testid="input-confirm-password"
              />
            </div>

            {passwordError && (
              <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-password-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <Button type="submit" disabled={changingPassword} data-testid="button-change-password" className="self-start">
              {changingPassword ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

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
