import { useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { MahaWordmark } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";

export default function Register() {
  const [, navigate] = useLocation();
  const [role, setRole] = useState<"partner" | "student">("partner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [profession, setProfession] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (role === "partner" && !homepageUrl.trim()) {
      setError("A homepage/website URL is required for partner registration as proof of practice.");
      return;
    }
    if (!file) {
      setError("Please upload a degree, license, or certification document.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("context", "registration");
      const uploadRes = await apiRequest("POST", "/api/auth/upload-document", formData, true);
      const uploadData = await uploadRes.json();

      await apiRequest("POST", "/api/auth/register", {
        role,
        name,
        email,
        password,
        phone,
        businessName: role === "partner" ? businessName : undefined,
        vatNumber: role === "partner" ? vatNumber : undefined,
        profession: role === "student" ? profession : undefined,
        homepageUrl,
        degreeFileUrl: uploadData.url,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-sm" data-testid="card-registration-success">
          <CardContent className="flex flex-col items-center gap-4 text-center pt-6">
            <MahaWordmark width={130} />
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <h1 className="text-xl font-semibold">Registration submitted</h1>
            <p className="text-sm text-muted-foreground">
              Thanks, {name.split(" ")[0]}. Our team will review your details and documents shortly. You'll be able
              to log in once approved.
            </p>
            <Button onClick={() => navigate("/login")} data-testid="button-goto-login">
              Back to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col items-center gap-2 pb-2">
          <MahaWordmark width={150} />
          <h1 className="text-xl font-semibold">Register</h1>
          <p className="text-sm text-muted-foreground text-center">
            Partner clinics &amp; Institute students — accounts are reviewed before activation.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>I am registering as</Label>
              <RadioGroup value={role} onValueChange={(v) => setRole(v as "partner" | "student")} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="partner" id="role-partner" data-testid="radio-role-partner" />
                  <Label htmlFor="role-partner" className="font-normal">Clinic Partner</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="student" id="role-student" data-testid="radio-role-student" />
                  <Label htmlFor="role-student" className="font-normal">Institute Student</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
              </div>

              {role === "partner" ? (
                <>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label htmlFor="businessName">Business / clinic name</Label>
                    <Input id="businessName" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} data-testid="input-business-name" />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label htmlFor="vatNumber">VAT number (optional)</Label>
                    <Input id="vatNumber" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} data-testid="input-vat" />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label htmlFor="homepageUrl">Homepage / website URL (required)</Label>
                    <Input id="homepageUrl" required placeholder="https://" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} data-testid="input-homepage" />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2 col-span-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm" data-testid="callout-assessment-form">
                    <span className="text-foreground">
                      Not sure which module fits you yet? Take our short, non-binding{" "}
                      <a
                        href="https://docs.google.com/forms/d/1g-xRfSYW5ykkCjriXf8jIsa0bR-kmQkhHYJbyugt_bo/viewform"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary font-medium underline underline-offset-2"
                        data-testid="link-assessment-form"
                      >
                        Institute assessment form
                      </a>{" "}
                      first — we'll use it to recommend the right study group before you register.
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label htmlFor="profession">Profession</Label>
                    <Input id="profession" required value={profession} onChange={(e) => setProfession(e.target.value)} data-testid="input-profession" />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label htmlFor="homepageUrl">Homepage / website URL (optional)</Label>
                    <Input id="homepageUrl" placeholder="https://" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} data-testid="input-homepage" />
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="document">Degree / license / certification (PDF or image)</Label>
                <label
                  htmlFor="document"
                  className="flex items-center gap-2 border border-input rounded-md px-3 py-2 text-sm cursor-pointer hover-elevate active-elevate-2"
                  data-testid="label-upload-document"
                >
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground truncate">{file ? file.name : "Choose file..."}</span>
                </label>
                <input
                  id="document"
                  type="file"
                  accept=".pdf,image/*"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  data-testid="input-document"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-register-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={submitting} data-testid="button-submit-register">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit registration
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium" data-testid="link-login">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
