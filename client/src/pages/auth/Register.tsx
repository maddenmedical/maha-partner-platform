import { useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { MahaWordmark } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle2, Loader2, Stethoscope, Upload } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";

export default function Register() {
  const [, navigate] = useLocation();
  const [role, setRole] = useState<"partner" | "student">("partner");
  const [prefix, setPrefix] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [country, setCountry] = useState("");
  const [profession, setProfession] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      let uploadedFileUrl: string | undefined;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("context", "registration");
        const uploadRes = await apiRequest("POST", "/api/auth/upload-document", formData, true);
        const uploadData = await uploadRes.json();
        uploadedFileUrl = uploadData.url;
      }

      await apiRequest("POST", "/api/auth/register", {
        role,
        prefix: prefix || undefined,
        firstName,
        lastName,
        suffix: suffix || undefined,
        email,
        username,
        password,
        phone,
        businessName: role === "partner" ? businessName : undefined,
        vatNumber: role === "partner" ? vatNumber : undefined,
        city: city || undefined,
        address: address || undefined,
        country: country || undefined,
        profession: role === "student" ? profession : undefined,
        homepageUrl: homepageUrl || undefined,
        degreeFileUrl: uploadedFileUrl,
        additionalInfo: additionalInfo || undefined,
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
              Thanks, {firstName}. Our team will review your details and documents shortly. You'll be able
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
          <h1 className="text-xl font-semibold">Registration</h1>
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

            <div
              className="flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm"
              data-testid="notice-medical-specialist"
            >
              <Stethoscope className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span className="text-foreground">
                <strong>You must be a medical specialist to register.</strong> Please provide additional
                information about your qualification or specialty below — our team verifies this before
                approving accounts.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prefix">Prefix</Label>
                <Input id="prefix" placeholder="Dr., Prof." value={prefix} onChange={(e) => setPrefix(e.target.value)} data-testid="input-prefix" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="suffix">Suffix</Label>
                <Input id="suffix" placeholder="PhD, MD" value={suffix} onChange={(e) => setSuffix(e.target.value)} data-testid="input-suffix" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-first-name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-last-name" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="email">User Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} data-testid="input-username" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="password">User Password</Label>
                <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} data-testid="input-confirm-password" />
              </div>

              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="businessName">Business name{role === "partner" ? "" : " (optional)"}</Label>
                <Input id="businessName" required={role === "partner"} value={businessName} onChange={(e) => setBusinessName(e.target.value)} data-testid="input-business-name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vatNumber">VAT number</Label>
                <Input id="vatNumber" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} data-testid="input-vat" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} data-testid="input-city" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} data-testid="input-address" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="country">Country</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger id="country" data-testid="select-country">
                    <SelectValue placeholder="Select a country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {role === "partner" ? (
                <div className="flex flex-col gap-1.5 col-span-2">
                  <Label htmlFor="homepageUrl">Homepage / website URL (optional)</Label>
                  <Input id="homepageUrl" placeholder="https://" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} data-testid="input-homepage" />
                </div>
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
                <Label htmlFor="additionalInfo">Additional information (optional)</Label>
                <Textarea
                  id="additionalInfo"
                  placeholder="Please describe your medical specialty and qualifications (e.g. dentist, physician, naturopath) so we can verify your eligibility."
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  data-testid="input-additional-info"
                />
              </div>

              <div className="flex flex-col gap-1.5 col-span-2">
                <Label htmlFor="document">Degree / license / certification (PDF or image, optional)</Label>
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
