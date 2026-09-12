import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertReferralSchema, type Referral } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";

const formSchema = insertReferralSchema.omit({ partnerId: true }).extend({
  attachmentUrl: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

interface ReferralFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkThreadId?: number;
  onSuccess: (referral: Referral & { chatThreadId: number }) => void;
}

// The same short referral form as the standalone "Refer a Patient" page,
// used inline from within a chat -- either the partner/student's own
// "Create patient referral" click, or filling in the form after an admin
// "referral requested" prompt. When linkThreadId is passed, the backend
// links (or creates) the dedicated referral chat for that conversation.
// When omitted (e.g. the "new patient" branch of "New chat"), the backend
// creates a brand-new dedicated referral chat instead.
export function ReferralFormDialog({ open, onOpenChange, linkThreadId, onSuccess }: ReferralFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
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
      const res = await apiRequest("POST", "/api/referrals", {
        ...values,
        attachmentUrl: attachmentUrl || undefined,
        patientConsentAttested: attested,
        ...(linkThreadId ? { linkThreadId } : {}),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/home-summary"] });
      form.reset();
      setFile(null);
      setAttested(false);
      onOpenChange(false);
      toast({ title: "Referral submitted", description: "The MAHA team has been notified." });
      onSuccess(data);
    },
    onError: (err: any) => {
      toast({ title: "Could not submit referral", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-referral-form">
        <DialogHeader>
          <DialogTitle>Create patient referral</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-ref-first-name">Patient first name</Label>
              <Input id="chat-ref-first-name" {...form.register("patientFirstName")} data-testid="input-chat-referral-first-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-ref-last-name">Patient last name</Label>
              <Input id="chat-ref-last-name" {...form.register("patientLastName")} data-testid="input-chat-referral-last-name" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-ref-contact">Patient phone or email</Label>
            <Input id="chat-ref-contact" {...form.register("patientContact")} data-testid="input-chat-referral-contact" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-ref-description">Reason / case description</Label>
            <Textarea id="chat-ref-description" rows={3} {...form.register("caseDescription")} data-testid="textarea-chat-referral-description" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Urgency</Label>
            <RadioGroup defaultValue="Normal" onValueChange={(v) => form.setValue("urgency", v)} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="Normal" id="chat-urgency-normal" data-testid="radio-chat-urgency-normal" />
                <Label htmlFor="chat-urgency-normal" className="font-normal">Normal</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="Urgent" id="chat-urgency-urgent" data-testid="radio-chat-urgency-urgent" />
                <Label htmlFor="chat-urgency-urgent" className="font-normal">Urgent</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-ref-notes">Notes (optional)</Label>
            <Textarea id="chat-ref-notes" rows={2} {...form.register("notes")} data-testid="textarea-chat-referral-notes" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-ref-attachment">Attachment (optional)</Label>
            <label
              htmlFor="chat-ref-attachment"
              className="flex items-center gap-2 border border-input rounded-md px-3 py-2 text-sm cursor-pointer hover-elevate active-elevate-2"
              data-testid="label-chat-referral-attachment"
            >
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground truncate">{file ? file.name : "Attach a file..."}</span>
            </label>
            <input
              id="chat-ref-attachment"
              type="file"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              data-testid="input-chat-referral-attachment"
            />
          </div>
          <div className="flex items-start gap-2.5" data-testid="row-chat-referral-attestation">
            <Checkbox
              id="chat-patientConsentAttested"
              checked={attested}
              onCheckedChange={(v) => setAttested(v === true)}
              className="mt-0.5"
              data-testid="checkbox-chat-referral-attestation"
            />
            <Label htmlFor="chat-patientConsentAttested" className="font-normal text-sm leading-relaxed">
              I confirm I'm entitled to share this patient's information with MAHA/Vidvana d.o.o. for
              care coordination, and that I've met my own obligations toward the patient.
            </Label>
          </div>

          <Button type="submit" disabled={mutation.isPending || uploading || !attested} data-testid="button-submit-chat-referral">
            {(mutation.isPending || uploading) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Send referral
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
