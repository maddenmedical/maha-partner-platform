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
import { ScanFace, Trash2, Loader2, Smartphone, KeyRound, AlertCircle, UserCog, Upload, FileText } from "lucide-react";
import { format } from "date-fns";
import {
  browserSupportsWebAuthn, registerPasskey, deletePasskey, type WebauthnCredentialSummary,
} from "@/lib/webauthn";

type ProfileFormState = {
  prefix: string;
  firstName: string;
  lastName: string;
  suffix: string;
  email: string;
  username: string;
  phone: string;
  businessName: string;
  vatNumber: string;
  profession: string;
  homepageUrl: string;
  city: string;
  address: string;
  country: string;
  degreeFileUrl: string;
};

function emptyProfileForm(): ProfileFormState {
  return {
    prefix: "", firstName: "", lastName: "", suffix: "", email: "", username: "", phone: "",
    businessName: "", vatNumber: "", profession: "", homepageUrl: "", city: "", address: "", country: "",
    degreeFileUrl: "",
  };
}

// Account settings shared across all roles (partner, student, admin).
// Sections: change password, manage Face ID / Fingerprint (WebAuthn passkeys).
export default function Account() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm());
  const [degreeFile, setDegreeFile] = useState<File | null>(null);
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Seed the editable form from the logged-in user once per session (not on
  // every render) so in-progress edits survive unrelated auth-context updates.
  useEffect(() => {
    if (!user) return;
    setProfileForm({
      prefix: user.prefix ?? "",
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      suffix: user.suffix ?? "",
      email: user.email ?? "",
      username: user.username ?? "",
      phone: user.phone ?? "",
      businessName: user.businessName ?? "",
      vatNumber: user.vatNumber ?? "",
      profession: user.profession ?? "",
      homepageUrl: user.homepageUrl ?? "",
      city: user.city ?? "",
      address: user.address ?? "",
      country: user.country ?? "",
      degreeFileUrl: user.degreeFileUrl ?? "",
    });
  }, [user?.id]);

  function updateField<K extends keyof ProfileFormState>(key: K, value: string) {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError("");
    setSavingProfile(true);
    try {
      let degreeFileUrl = profileForm.degreeFileUrl;
      if (degreeFile) {
        const formData = new FormData();
        formData.append("file", degreeFile);
        const uploadRes = await apiRequest("POST", "/api/auth/upload-document", formData, true);
        const uploadData = await uploadRes.json();
        degreeFileUrl = uploadData.url;
      }
      const res = await apiRequest("PATCH", "/api/auth/profile", { ...profileForm, degreeFileUrl });
      const data = await res.json();
      updateUser(data.user);
      setDegreeFile(null);
      toast({ title: "Profile updated", description: "Your details have been saved." });
    } catch (err: any) {
      setProfileError(err.message || "Could not save your profile");
    } finally {
      setSavingProfile(false);
    }
  }

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
            <UserCog className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">Profile details</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Update your name, contact details, and account info.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="flex flex-col gap-1.5 col-span-1">
                <Label htmlFor="profile-prefix">Title</Label>
                <Input id="profile-prefix" value={profileForm.prefix} onChange={(e) => updateField("prefix", e.target.value)} placeholder="Dr." data-testid="input-profile-prefix" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-1 sm:col-span-1">
                <Label htmlFor="profile-first-name">First name</Label>
                <Input id="profile-first-name" value={profileForm.firstName} onChange={(e) => updateField("firstName", e.target.value)} required data-testid="input-profile-first-name" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-1 sm:col-span-1">
                <Label htmlFor="profile-last-name">Last name</Label>
                <Input id="profile-last-name" value={profileForm.lastName} onChange={(e) => updateField("lastName", e.target.value)} required data-testid="input-profile-last-name" />
              </div>
              <div className="flex flex-col gap-1.5 col-span-1">
                <Label htmlFor="profile-suffix">Post-nominal</Label>
                <Input id="profile-suffix" value={profileForm.suffix} onChange={(e) => updateField("suffix", e.target.value)} placeholder="DDS, PhD" data-testid="input-profile-suffix" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" type="email" value={profileForm.email} onChange={(e) => updateField("email", e.target.value)} required data-testid="input-profile-email" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-username">Username</Label>
                <Input id="profile-username" value={profileForm.username} onChange={(e) => updateField("username", e.target.value)} data-testid="input-profile-username" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-phone">Phone</Label>
                <Input id="profile-phone" value={profileForm.phone} onChange={(e) => updateField("phone", e.target.value)} data-testid="input-profile-phone" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-profession">Profession</Label>
                <Input id="profile-profession" value={profileForm.profession} onChange={(e) => updateField("profession", e.target.value)} data-testid="input-profile-profession" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-business-name">Business name</Label>
                <Input id="profile-business-name" value={profileForm.businessName} onChange={(e) => updateField("businessName", e.target.value)} data-testid="input-profile-business-name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-vat">VAT number</Label>
                <Input id="profile-vat" value={profileForm.vatNumber} onChange={(e) => updateField("vatNumber", e.target.value)} data-testid="input-profile-vat" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-homepage">Homepage URL</Label>
                <Input id="profile-homepage" value={profileForm.homepageUrl} onChange={(e) => updateField("homepageUrl", e.target.value)} data-testid="input-profile-homepage" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-city">City</Label>
                <Input id="profile-city" value={profileForm.city} onChange={(e) => updateField("city", e.target.value)} data-testid="input-profile-city" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-address">Address</Label>
                <Input id="profile-address" value={profileForm.address} onChange={(e) => updateField("address", e.target.value)} data-testid="input-profile-address" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-country">Country</Label>
                <Input id="profile-country" value={profileForm.country} onChange={(e) => updateField("country", e.target.value)} data-testid="input-profile-country" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-degree-file">Degree / license document</Label>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="profile-degree-file"
                  className="flex-1 flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm cursor-pointer hover-elevate"
                  data-testid="label-profile-degree-file"
                >
                  <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate">{degreeFile ? degreeFile.name : "Choose a new file to replace it..."}</span>
                </label>
                <input
                  id="profile-degree-file"
                  type="file"
                  accept=".pdf,image/*"
                  className="sr-only"
                  onChange={(e) => setDegreeFile(e.target.files?.[0] || null)}
                  data-testid="input-profile-degree-file"
                />
              </div>
              {profileForm.degreeFileUrl && !degreeFile && (
                <a
                  href={profileForm.degreeFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  data-testid="link-profile-degree-file-current"
                >
                  <FileText className="h-3.5 w-3.5" /> View current document
                </a>
              )}
            </div>

            {profileError && (
              <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-profile-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{profileError}</span>
              </div>
            )}

            <Button type="submit" disabled={savingProfile} data-testid="button-save-profile" className="self-start">
              {savingProfile ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

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
