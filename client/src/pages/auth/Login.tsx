import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MahaWordmark, ThemeToggleIcon } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InstallAppButton } from "@/components/InstallAppButton";
import { AlertCircle, Loader2, ScanFace } from "lucide-react";
import { browserSupportsWebAuthn, loginWithPasskey } from "@/lib/webauthn";
// Client-provided brand photography: a MAHA clinician greeting a partner-clinic
// patient. Chosen over the wide stats/lecture image because its two upright
// figures read cleanly in the tall login side panel without cropping heads.
import loginPhoto from "@/assets/brand/handshake-supplement.jpg";

export default function Login() {
  const { login, loginWithToken, pendingState, clearPending } = useAuth();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

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

  async function handlePasskeyLogin() {
    setError("");
    setPasskeySubmitting(true);
    try {
      const { token, user } = await loginWithPasskey();
      loginWithToken(token, user);
    } catch (err: any) {
      // The browser throws its own error (e.g. "NotAllowedError") when the
      // user cancels the biometric prompt — don't show that as a scary error.
      if (err?.name !== "NotAllowedError") {
        setError(err.message || "Face ID / Fingerprint sign-in failed");
      }
    } finally {
      setPasskeySubmitting(false);
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
        <div className="relative z-10 flex flex-col justify-end p-10" data-testid="panel-login-stats">
          <div className="flex flex-col gap-2.5 max-w-sm">
            <p className="font-serif text-xl text-[#f5efe4] leading-snug">
              <span className="font-semibold">60–80%</span> of your patients have gut dysbiosis
            </p>
            <p className="font-serif text-xl text-[#f5efe4] leading-snug">
              <span className="font-semibold">90%</span> of your patients have gum inflammation
            </p>
            <p className="font-serif text-xl text-[#f5efe4] leading-snug">
              <span className="font-semibold">50%</span> of your patients have periodontal infections
            </p>
            <p className="font-serif text-xl text-[#f5efe4] leading-snug">
              <span className="font-semibold">50%</span> of your patients have root canals
            </p>
          </div>
          <p className="text-sm text-[#e8ded0]/80 mt-4 max-w-sm">MAHA Partner Portal</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8">
          <MahaWordmark width={220} />
          <p className="text-base text-muted-foreground text-center">Partner Portal — sign in to your account</p>
        </CardHeader>
        <CardContent className="p-8 pt-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-base">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@clinic.com"
                className="h-12 text-base"
                data-testid="input-email"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-base">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 text-base"
                data-testid="input-password"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-login-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting} className="h-12 text-base font-medium" data-testid="button-submit-login">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in
            </Button>
          </form>
          {passkeySupported && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 text-base font-medium"
                disabled={passkeySubmitting}
                onClick={handlePasskeyLogin}
                data-testid="button-passkey-login"
              >
                {passkeySubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ScanFace className="h-4 w-4 mr-2" />
                )}
                Sign in with Face ID / Fingerprint
              </Button>
            </>
          )}
          <p className="text-base text-muted-foreground text-center mt-6">
            New partner or student?{" "}
            <Link href="/register" className="text-primary font-medium" data-testid="link-register">
              Register here
            </Link>
          </p>
        </CardContent>
      </Card>
      <p className="text-[10px] text-muted-foreground/40 mt-8" data-testid="text-app-credit">
        Webapp provided by Madden Medical e.U.
      </p>
      </div>
    </div>
  );
}
