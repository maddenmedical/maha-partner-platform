import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { MyPartnerLevelCard } from "@/components/MyPartnerLevelCard";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { resizeImageToDataUrl } from "@/lib/imageResize";
import { isPushSupported, subscribeToPush } from "@/lib/push";
import {
  ScanFace, Trash2, Loader2, Smartphone, KeyRound, AlertCircle, UserCog, Upload, FileText, Camera,
  Bell, Users, MessageSquare, ShoppingBag, Megaphone,
} from "lucide-react";
import { format } from "date-fns";
import {
  browserSupportsWebAuthn, registerPasskey, deletePasskey, type WebauthnCredentialSummary,
} from "@/lib/webauthn";

type NotifyCategory = "community" | "chat" | "orders" | "offers" | "staff";
type NotifyStyle = "preview" | "alert" | "silent";

interface NotifyCategoryConfig {
  key: NotifyCategory;
  icon: typeof Bell;
  label: string;
  description: string;
}

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

// Notification category copy, with role-aware descriptions since the same
// four categories mean slightly different things to an admin vs. a partner.
function notifyCategoryConfigs(role: string | undefined): NotifyCategoryConfig[] {
  const isAdmin = role === "admin";
  return [
    {
      key: "community",
      icon: Users,
      label: "Community Chat",
      description: "New topics and replies posted in Community Chat.",
    },
    {
      key: "chat",
      icon: MessageSquare,
      label: "Patient chat",
      description: isAdmin
        ? "New patient chats and unanswered-chat reminders."
        : "Replies from the MAHA team in your patient chats.",
    },
    {
      key: "orders",
      icon: ShoppingBag,
      label: "Shop orders",
      description: isAdmin
        ? "Shop order status updates."
        : "Updates on the status of your shop orders.",
    },
    {
      key: "offers",
      icon: Megaphone,
      label: isAdmin ? "Announcements & level-ups" : "Announcements & offers",
      description: isAdmin
        ? "Partner level-up alerts and your own outgoing announcements."
        : "New announcements and special offers from MAHA.",
    },
    // Admin-only -- the Staff Room and 1:1 admin DMs are internal, so this
    // category is never rendered for partners/students (filtered below).
    ...(isAdmin
      ? [
          {
            key: "staff" as const,
            icon: Users,
            label: "Staff chat",
            description: "Messages in the Staff Room or a direct message from another admin.",
          },
        ]
      : []),
  ];
}

const NOTIFY_STYLE_OPTIONS: { value: NotifyStyle; label: string; description: string }[] = [
  { value: "preview", label: "Preview", description: "Show the full message, e.g. who sent it and what it says." },
  { value: "alert", label: "Alert only", description: "Notify me, but don't show the content." },
  { value: "silent", label: "Silent", description: "No push \u2014 just bump the in-app unread badge." },
];

type NotifyPrefs = Record<NotifyCategory, { enabled: boolean; style: NotifyStyle }>;

// Account settings shared across all roles (partner, student, admin).
// Sections: change password, manage Face ID / Fingerprint (WebAuthn passkeys).
export default function Account() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const notifyConfigs = notifyCategoryConfigs(user?.role);
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>({
    community: { enabled: true, style: "preview" },
    chat: { enabled: true, style: "preview" },
    orders: { enabled: true, style: "preview" },
    offers: { enabled: true, style: "preview" },
    staff: { enabled: true, style: "preview" },
  });
  const [notifySaving, setNotifySaving] = useState<NotifyCategory | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [enablingPush, setEnablingPush] = useState(false);

  // Seed local notification-preference state from the logged-in user, same
  // pattern as the profile form below.
  useEffect(() => {
    if (!user) return;
    setNotifyPrefs({
      community: { enabled: user.notifyCommunityEnabled ?? true, style: (user.notifyCommunityStyle as NotifyStyle) ?? "preview" },
      chat: { enabled: user.notifyChatEnabled ?? true, style: (user.notifyChatStyle as NotifyStyle) ?? "preview" },
      orders: { enabled: user.notifyOrdersEnabled ?? true, style: (user.notifyOrdersStyle as NotifyStyle) ?? "preview" },
      offers: { enabled: user.notifyOffersEnabled ?? true, style: (user.notifyOffersStyle as NotifyStyle) ?? "preview" },
      staff: { enabled: user.notifyStaffEnabled ?? true, style: (user.notifyStaffStyle as NotifyStyle) ?? "preview" },
    });
  }, [user?.id, user?.notifyCommunityEnabled, user?.notifyCommunityStyle, user?.notifyChatEnabled, user?.notifyChatStyle, user?.notifyOrdersEnabled, user?.notifyOrdersStyle, user?.notifyOffersEnabled, user?.notifyOffersStyle, user?.notifyStaffEnabled, user?.notifyStaffStyle]);

  useEffect(() => {
    setPushPermission(isPushSupported() ? Notification.permission : "unsupported");
  }, []);

  async function saveNotifyPref(category: NotifyCategory, patch: { enabled?: boolean; style?: NotifyStyle }) {
    const prev = notifyPrefs[category];
    const next = { ...prev, ...patch };
    setNotifyPrefs((cur) => ({ ...cur, [category]: next }));
    setNotifySaving(category);
    try {
      const res = await apiRequest("PATCH", "/api/notifications/preferences", {
        category,
        enabled: next.enabled,
        style: next.style,
      });
      const data = await res.json();
      updateUser(data);
    } catch (err: any) {
      // Roll back on failure so the UI never shows a state the server didn't save.
      setNotifyPrefs((cur) => ({ ...cur, [category]: prev }));
      toast({ title: "Could not update notification setting", description: err.message, variant: "destructive" });
    } finally {
      setNotifySaving(null);
    }
  }

  async function handleEnablePushDevice() {
    setEnablingPush(true);
    try {
      await subscribeToPush();
      setPushPermission("granted");
      toast({ title: "Push notifications enabled on this device" });
    } catch (err: any) {
      toast({ title: "Could not enable push", description: err.message, variant: "destructive" });
    } finally {
      setEnablingPush(false);
    }
  }

  const [passkeySupported, setPasskeySupported] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm());
  const [degreeFile, setDegreeFile] = useState<File | null>(null);
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

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

  // Uploads immediately on selection (rather than waiting for the profile
  // form's Save button) so it behaves like a normal avatar picker and takes
  // effect right away in chat and admin lists.
  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError("");
    setUploadingPhoto(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const res = await apiRequest("PATCH", "/api/auth/profile", { photoUrl: dataUrl });
      const data = await res.json();
      updateUser(data.user);
      queryClient.invalidateQueries();
      toast({ title: "Photo updated" });
    } catch (err: any) {
      setPhotoError(err.message || "Could not upload that photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRemovePhoto() {
    setPhotoError("");
    setUploadingPhoto(true);
    try {
      const res = await apiRequest("PATCH", "/api/auth/profile", { photoUrl: null });
      const data = await res.json();
      updateUser(data.user);
      queryClient.invalidateQueries();
    } catch (err: any) {
      setPhotoError(err.message || "Could not remove photo");
    } finally {
      setUploadingPhoto(false);
    }
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

      {(user?.role === "partner" || user?.role === "student") && (
        <MyPartnerLevelCard />
      )}

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

          <div className="flex items-center gap-4">
            <UserAvatar photoUrl={user?.photoUrl} name={user?.name || ""} size="lg" />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploadingPhoto}
                  onClick={() => photoInputRef.current?.click()}
                  data-testid="button-upload-photo"
                >
                  {uploadingPhoto ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {user?.photoUrl ? "Change photo" : "Upload photo"}
                </Button>
                {user?.photoUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={uploadingPhoto}
                    onClick={handleRemovePhoto}
                    data-testid="button-remove-photo"
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Shown next to your messages in chat{user?.role === "admin" ? " and in the partner list" : ""}.</p>
              {photoError && <p className="text-xs text-destructive" data-testid="text-photo-error">{photoError}</p>}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                data-testid="input-photo-file"
              />
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
        <CardContent className="p-4 flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">Notifications</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Choose how you want to hear about each type of update. These settings are just for you.
              </p>
            </div>
          </div>

          {pushPermission !== "granted" && pushPermission !== "unsupported" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3" data-testid="banner-enable-push-device">
              <p className="text-xs text-muted-foreground">
                Push notifications aren't enabled on this device yet. Turn them on to actually receive what you choose below.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={enablingPush}
                onClick={handleEnablePushDevice}
                data-testid="button-enable-push-device"
                className="shrink-0"
              >
                {enablingPush ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                Enable on this device
              </Button>
            </div>
          )}

          <div className="flex flex-col divide-y divide-border">
            {notifyConfigs.map((cfg) => {
              const pref = notifyPrefs[cfg.key];
              const Icon = cfg.icon;
              return (
                <div key={cfg.key} className="py-4 first:pt-0 last:pb-0 flex flex-col gap-3" data-testid={`section-notify-${cfg.key}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium" data-testid={`text-notify-label-${cfg.key}`}>{cfg.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
                      </div>
                    </div>
                    <Switch
                      checked={pref.enabled}
                      disabled={notifySaving === cfg.key}
                      onCheckedChange={(checked) => saveNotifyPref(cfg.key, { enabled: checked })}
                      aria-label={`Toggle ${cfg.label} notifications`}
                      data-testid={`switch-notify-${cfg.key}`}
                      className="shrink-0"
                    />
                  </div>

                  {pref.enabled && (
                    <RadioGroup
                      value={pref.style}
                      onValueChange={(value) => saveNotifyPref(cfg.key, { style: value as NotifyStyle })}
                      className="pl-7 grid grid-cols-1 sm:grid-cols-3 gap-2"
                      data-testid={`radiogroup-notify-style-${cfg.key}`}
                    >
                      {NOTIFY_STYLE_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          htmlFor={`notify-${cfg.key}-${opt.value}`}
                          className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover-elevate has-[[data-state=checked]]:border-primary"
                        >
                          <RadioGroupItem
                            value={opt.value}
                            id={`notify-${cfg.key}-${opt.value}`}
                            disabled={notifySaving === cfg.key}
                            data-testid={`radio-notify-${cfg.key}-${opt.value}`}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium">{opt.label}</span>
                            <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{opt.description}</span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                </div>
              );
            })}
          </div>
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

      <p className="text-xs text-muted-foreground/60 text-center" data-testid="text-account-legal-links">
        <a href="#/legal/privacy" className="underline underline-offset-2">Privacy Policy</a>
        {" · "}
        <a href="#/legal/terms" className="underline underline-offset-2">Terms of Use</a>
      </p>
    </div>
  );
}
