import { useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { MahaWordmark } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

// Reads the token out of the hash route's query string, e.g.
// "#/reset-password?token=abc123". Hash routing keeps the query string after
// the hash, so window.location.search is always empty for these links.
function readHashParams(): URLSearchParams {
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  return new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : "");
}

export default function ResetPassword() {
  const token = readHashParams().get("token") || "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, newPassword });
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md shadow-lg" data-testid="card-reset-password">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8">
          <MahaWordmark width={220} />
          <p className="text-base text-muted-foreground text-center">Choose a new password</p>
        </CardHeader>
        <CardContent className="p-8 pt-4">
          {!token ? (
            <div className="flex flex-col items-center gap-4 text-center py-4" data-testid="text-reset-no-token">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-foreground">
                This reset link is missing or invalid. Please request a new one.
              </p>
              <Button asChild variant="outline" data-testid="button-request-new-link">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-4 text-center py-4" data-testid="text-reset-done">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-sm text-foreground">Your password has been reset. You can now sign in with your new password.</p>
              <Button asChild data-testid="button-go-to-login">
                <Link href="/">Sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12"
                  data-testid="input-new-password"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12"
                  data-testid="input-confirm-password"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-reset-error">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" disabled={submitting} className="h-12 font-medium" data-testid="button-submit-reset">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reset password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
