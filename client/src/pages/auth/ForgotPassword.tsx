import { useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { MahaWordmark } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email });
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md shadow-lg" data-testid="card-forgot-password">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8">
          <MahaWordmark width={220} />
          <p className="text-base text-muted-foreground text-center">Reset your password</p>
        </CardHeader>
        <CardContent className="p-8 pt-4">
          {sent ? (
            <div className="flex flex-col items-center gap-4 text-center py-4" data-testid="text-reset-sent">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-sm text-foreground">
                If an account exists for <span className="font-medium">{email}</span>, we've sent a link to reset your password. Check your inbox (and spam folder).
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">
                Enter the email address you used to register. We'll send you a link to reset your password.
              </p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@clinic.com"
                  className="h-12"
                  data-testid="input-forgot-email"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-forgot-error">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" disabled={submitting} className="h-12 font-medium" data-testid="button-submit-forgot">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send reset link
              </Button>
            </form>
          )}
          <Link href="/" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-6" data-testid="link-back-to-login">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
