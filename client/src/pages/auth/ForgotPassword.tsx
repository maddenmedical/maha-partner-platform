import { useState } from "react";
import { Link } from "wouter";
import { MahaWordmark } from "@/components/MahaLogo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";

const SUPPORT_EMAIL = "partner@maha.clinic";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Something went wrong. Please try again.");
      }
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
            <div className="flex flex-col items-center gap-4 text-center py-2" data-testid="text-reset-link-sent">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-sm text-foreground">
                If <span className="font-medium">{email}</span> is registered, we've just sent a
                password reset link to that address. It expires in 1 hour.
              </p>
              <p className="text-xs text-muted-foreground">
                Didn't get it? Check spam, or contact{" "}
                <a href={`mailto:${SUPPORT_EMAIL}?subject=Password%20reset%20request`} className="underline">
                  {SUPPORT_EMAIL}
                </a>{" "}
                and an admin can reset it for you directly.
              </p>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@clinic.com"
                    className="h-12 text-base"
                    data-testid="input-forgot-email"
                  />
                </div>
                {error && (
                  <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-forgot-error">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" disabled={submitting} className="h-12 font-medium w-full" data-testid="button-send-reset-link">
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Send reset link
                </Button>
              </form>
              <div className="flex items-center gap-3 my-5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex flex-col items-center gap-3 text-center">
                <Mail className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Prefer not to wait on email? Contact{" "}
                  <span className="font-medium text-foreground">{SUPPORT_EMAIL}</span> and an admin
                  can reset your password for you.
                </p>
                <Button asChild variant="outline" className="h-10 text-sm w-full" data-testid="button-email-support">
                  <a href={`mailto:${SUPPORT_EMAIL}?subject=Password%20reset%20request`}>
                    Email {SUPPORT_EMAIL}
                  </a>
                </Button>
              </div>
            </>
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
