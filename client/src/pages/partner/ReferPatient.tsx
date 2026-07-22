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
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Loader2, Upload, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

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

  const { data: referrals, isLoading } = useQuery<Referral[]>({ queryKey: ["/api/referrals/mine"] });

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
      return apiRequest("POST", "/api/referrals", { ...values, attachmentUrl: attachmentUrl || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/home-summary"] });
      form.reset();
      setFile(null);
      setSubmitted(true);
      toast({ title: "Referral submitted", description: "The MAHA team has been notified." });
      setTimeout(() => setSubmitted(false), 3000);
    },
    onError: (err: any) => {
      toast({ title: "Could not submit referral", description: err.message, variant: "destructive" });
    },
  });

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
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" rows={2} {...form.register("notes")} data-testid="textarea-notes" />
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
            </div>

            <Button type="submit" disabled={mutation.isPending || uploading} data-testid="button-submit-referral">
              {(mutation.isPending || uploading) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitted ? <CheckCircle2 className="h-4 w-4 mr-2" /> : null}
              Send referral
            </Button>
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
              <Card key={r.id} data-testid={`card-referral-${r.id}`}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.patientFirstName} {r.patientLastName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.caseDescription}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{format(new Date(r.createdAt), "MMM d, yyyy")}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
