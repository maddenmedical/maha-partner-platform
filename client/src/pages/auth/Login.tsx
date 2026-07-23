import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MahaWordmark, ThemeToggleIcon } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InstallAppButton } from "@/components/InstallAppButton";
import { AlertCircle, Loader2 } from "lucide-react";
// Client-provided brand photography: a MAHA clinician greeting a partner-clinic
// patient. Chosen over the wide stats/lecture image because its two upright
// figures read cleanly in the tall login side panel without cropping heads.
import loginPhoto from "@/assets/brand/handshake-supplement.jpg";

export default function Login() {
  const { login, pendingState, clearPending } = useAuth();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingState) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-sm" data-testid="card-pending-approval">
          <CardHeader className="flex flex-col items-center gap-3 pb-2">
            <MahaWordmark width={140} />
            <h1 className="text-xl font-semibold text-center">Your account is pending review</h1>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 items-center text-center">
            <p className="text-sm text-muted-foreground max-w-xs">
              {pendingState.status === "rejected"
                ? "Your registration was not approved. Please contact the MAHA team for more information."
                : "Thanks for registering. Our team is reviewing your submitted documents and homepage link. You'll be able to log in once approved."}
            </p>
            <Button variant="outline" onClick={clearPending} data-testid="button-back-to-login">
              Back to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex bg-background relative">
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <InstallAppButton variant="full" />
        <button
          onClick={toggle}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="h-9 w-9 flex items-center justify-center rounded-md hover-elevate active-elevate-2 text-muted-foreground"
          data-testid="button-theme-toggle"
        >
          <ThemeToggleIcon dark={theme === "dark"} />
        </button>
      </div>

      {/* Brand photography side panel — hidden on small screens, visible from md up */}
      <div className="hidden md:flex md:w-1/2 relative overflow-hidden" data-testid="panel-login-photo">
        <img
          src={loginPhoto}
          alt="A MAHA clinician greeting a partner-clinic patient with a MAHA supplement"
          className="absolute inset-0 w-full h-full object-cover object-[center_30%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(240_20%_12%/0.88)] via-[hsl(240_20%_14%/0.35)] to-[hsl(240_20%_14%/0.15)]" />
        <div className="relative z-10 flex flex-col justify-end p-10">
          <p className="font-serif text-2xl text-[#f5efe4] leading-snug max-w-sm">
            Biological medicine for practitioners who want measurable outcomes.
          </p>
          <p className="text-sm text-[#e8ded0]/80 mt-3 max-w-sm">MAHA Partner Portal</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-2 pb-2">
          <MahaWordmark width={170} />
          <p className="text-sm text-muted-foreground text-center">Partner Portal — sign in to your account</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@clinic.com"
                data-testid="input-email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                data-testid="input-password"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-login-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting} data-testid="button-submit-login">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-6">
            New partner or student?{" "}
            <Link href="/register" className="text-primary font-medium" data-testid="link-register">
              Register here
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
