import { useState } from "react";
import { Link } from "wouter";
import { MahaWordmark } from "@/components/MahaLogo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

// Hash routing keeps the query string after the hash (e.g.
// "#/reset-password?token=..."), so window.location.search is empty here.
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
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token, newPassword });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not reset your password.");
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Could not reset your password.");
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
            <div className="flex flex-col items-center gap-4 text-center py-2" data-testid="text-reset-missing-token">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-foreground">
                This reset link is missing or malformed. Please request a new one.
              </p>
              <Button asChild className="h-12 font-medium w-full" data-testid="button-request-new-link">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-4 text-center py-2" data-testid="text-reset-success">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-sm text-foreground">Your password has been reset.</p>
              <Button asChild className="h-12 font-medium w-full" data-testid="button-go-to-login">
                <Link href="/">Sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 text-base"
                  data-testid="input-new-password"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 text-base"
                  data-testid="input-confirm-password"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-reset-error">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" disabled={submitting} className="h-12 font-medium w-full" data-testid="button-submit-reset">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reset password
              </Button>
            </form>
          )}
          <Link
            href="/"
            className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-6"
            data-testid="link-back-to-login"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
