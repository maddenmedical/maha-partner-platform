import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertReferralSchema, type Referral } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Loader2, Upload, CheckCircle2, FileText, MessageSquare, Info } from "lucide-react";
import { openAuthedFile } from "@/lib/fileAccess";
import { setPendingThreadId } from "@/lib/chatNav";
import { useLocation } from "wouter";
import { format } from "date-fns";

type ReferralRow = Referral & { chatThreadId: number | null };

const formSchema = insertReferralSchema.omit({ partnerId: true }).extend({
  attachmentUrl: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function ReferPatient() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [attested, setAttested] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      patientFirstName: "",
      patientLastName: "",
      patientContact: "",
      caseDescription: "",
      urgency: "Normal",
      notes: "",
      attachmentUrl: "",
    },
  });

  const { data: referrals, isLoading } = useQuery<ReferralRow[]>({ queryKey: ["/api/referrals/mine"] });
  const [selected, setSelected] = useState<ReferralRow | null>(null);
  const [, navigate] = useLocation();
  const [openChatAfterSubmit, setOpenChatAfterSubmit] = useState(false);

  function openReferralChat(threadId: number) {
    setPendingThreadId(threadId);
    navigate("/chat");
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      let attachmentUrl = "";
      if (file) {
        setUploading(true);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("context", "referral");
        const res = await apiRequest("POST", "/api/auth/upload-document", formData, true);
        const data = await res.json();
        attachmentUrl = data.url;
        setUploading(false);
      }
      const res = await apiRequest("POST", "/api/referrals", { ...values, attachmentUrl: attachmentUrl || undefined, patientConsentAttested: attested });
      return res.json() as Promise<Referral & { chatThreadId: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/home-summary"] });
      const shouldOpenChat = openChatAfterSubmit;
      form.reset();
      setFile(null);
      setAttested(false);
      setOpenChatAfterSubmit(false);
      setSubmitted(true);
      toast({ title: "Referral submitted", description: "The MAHA team has been notified." });
      setTimeout(() => setSubmitted(false), 3000);
      if (shouldOpenChat && data.chatThreadId) {
        openReferralChat(data.chatThreadId);
      }
    },
    onError: (err: any) => {
      setOpenChatAfterSubmit(false);
      toast({ title: "Could not submit referral", description: err.message, variant: "destructive" });
    },
  });

  const watched = form.watch();
  const mandatoryFieldsFilled =
    !!watched.patientFirstName?.trim() &&
    !!watched.patientLastName?.trim() &&
    !!watched.patientContact?.trim() &&
    !!watched.caseDescription?.trim() &&
    attested;

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Refer a Patient</h1>
        <p className="text-sm text-muted-foreground mt-1">Send patient details securely to the MAHA clinical team.</p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="patientFirstName">Patient first name</Label>
                <Input id="patientFirstName" {...form.register("patientFirstName")} data-testid="input-patient-first-name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="patientLastName">Patient last name</Label>
                <Input id="patientLastName" {...form.register("patientLastName")} data-testid="input-patient-last-name" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="patientContact">Patient phone or email</Label>
              <Input id="patientContact" {...form.register("patientContact")} data-testid="input-patient-contact" />
              <p className="text-xs text-muted-foreground">Only if you want us to reach out to the patient.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="caseDescription">Reason / case description</Label>
              <Textarea id="caseDescription" rows={4} {...form.register("caseDescription")} data-testid="textarea-case-description" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Urgency</Label>
              <RadioGroup
                defaultValue="Normal"
                onValueChange={(v) => form.setValue("urgency", v)}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Normal" id="urgency-normal" data-testid="radio-urgency-normal" />
                  <Label htmlFor="urgency-normal" className="font-normal">Normal</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Urgent" id="urgency-urgent" data-testid="radio-urgency-urgent" />
                  <Label htmlFor="urgency-urgent" className="font-normal">Urgent</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachment">Attachment (optional)</Label>
              <label
                htmlFor="attachment"
                className="flex items-center gap-2 border border-input rounded-md px-3 py-2 text-sm cursor-pointer hover-elevate active-elevate-2"
                data-testid="label-upload-attachment"
              >
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground truncate">{file ? file.name : "Attach a file..."}</span>
              </label>
              <input
                id="attachment"
                type="file"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                data-testid="input-attachment"
              />
              <p className="text-xs text-muted-foreground">Max. 50MB. For larger files send a link in the patient chat.</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3 flex gap-2.5" data-testid="note-cbct-info">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                <p>
                  <span className="font-medium text-foreground">A CBCT (Cone Beam CT) scan</span> gives Dr. Perko a much
                  clearer 3D view than a standard panoramic X-ray. If it would help this case, have it done at an
                  imaging/radiology center in your own country — there's no need to send the patient to us for it.
                </p>
                <p className="mt-1.5">
                  <span className="font-medium text-foreground">Sending the file:</span> under 50MB, attach it directly
                  above. Larger files (e.g. from a USB or a Google Drive/Dropbox link) don't hold up this referral —
                  once you submit it, we'll open a dedicated chat with you where you can paste the link whenever it's ready.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5" data-testid="row-referral-attestation">
              <Checkbox
                id="patientConsentAttested"
                checked={attested}
                onCheckedChange={(v) => setAttested(v === true)}
                className="mt-0.5"
                data-testid="checkbox-referral-attestation"
              />
              <Label htmlFor="patientConsentAttested" className="font-normal text-sm leading-relaxed">
                I confirm I'm entitled to share this patient's information with MAHA/Vidvana d.o.o. for
                care coordination, and that I've met my own obligations toward the patient (see{" "}
                <a href="#/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                  Privacy Policy §5
                </a>
                ).
              </Label>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={() => { setOpenChatAfterSubmit(false); form.handleSubmit((v) => mutation.mutate(v))(); }}
                disabled={mutation.isPending || uploading || !attested}
                className="flex-1"
                data-testid="button-submit-referral"
              >
                {(mutation.isPending || uploading) && !openChatAfterSubmit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {submitted ? <CheckCircle2 className="h-4 w-4 mr-2" /> : null}
                Send referral
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setOpenChatAfterSubmit(true); form.handleSubmit((v) => mutation.mutate(v))(); }}
                disabled={mutation.isPending || uploading || !mandatoryFieldsFilled}
                className="flex-1"
                data-testid="button-submit-referral-open-chat"
              >
                {(mutation.isPending || uploading) && openChatAfterSubmit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <MessageSquare className="h-4 w-4 mr-2" />
                Send referral &amp; open chat
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Your referral history</h2>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
            <Skeleton className="h-16 rounded-lg skeleton-shimmer" />
          </div>
        ) : !referrals || referrals.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No referrals yet"
            description="Submit your first patient referral using the form above."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {referrals.map((r) => (
              <Card
                key={r.id}
                className="cursor-pointer hover-elevate active-elevate-2"
                onClick={() => setSelected(r)}
                data-testid={`card-referral-${r.id}`}
              >
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.patientFirstName} {r.patientLastName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.caseDescription}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{format(new Date(r.createdAt), "MMM d, yyyy")}</p>
                    {r.chatThreadId && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openReferralChat(r.chatThreadId!); }}
                        className="text-primary flex items-center gap-1 text-xs mt-1.5"
                        data-testid={`link-open-chat-${r.id}`}
                      >
                        <MessageSquare className="h-3 w-3" /> Open chat
                      </button>
                    )}
                  </div>
                  <StatusBadge status={r.status} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="dialog-referral-detail">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.patientFirstName} {selected.patientLastName}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground/70">{format(new Date(selected.createdAt), "MMM d, yyyy")}</p>
                  <StatusBadge status={selected.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Patient contact</p>
                  <p data-testid="text-referral-detail-contact">{selected.patientContact}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Urgency</p>
                  <p data-testid="text-referral-detail-urgency">{selected.urgency}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Case description</p>
                  <p className="whitespace-pre-wrap" data-testid="text-referral-detail-description">{selected.caseDescription}</p>
                </div>
                {selected.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                    <p className="whitespace-pre-wrap" data-testid="text-referral-detail-notes">{selected.notes}</p>
                  </div>
                )}
                {selected.attachmentUrl && (
                  <button
                    type="button"
                    onClick={() => openAuthedFile(selected.attachmentUrl!).catch((e) => toast({ title: "Could not open attachment", description: e.message, variant: "destructive" }))}
                    className="text-primary flex items-center gap-1.5 text-sm"
                    data-testid="link-referral-detail-attachment"
                  >
                    <FileText className="h-4 w-4" /> View attachment
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
