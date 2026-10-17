import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Loader2, ArrowLeft, Search } from "lucide-react";
import type { AdminChatRecipient, StartAdminChatInput } from "@shared/schema";

const referralMessage = 'Please complete the patient referral form using "Fill in referral form" in this chat. We can then coordinate the case here. Thank you.';
const defaultTopic = (mode: "general" | "referral") => mode === "referral" ? "Patient referral request" : "General";

export function AdminNewChat({ onStarted }: { onStarted: (threadId: number) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [partner, setPartner] = useState<AdminChatRecipient | null>(null);
  const [mode, setMode] = useState<"general" | "referral">("general");
  const [topic, setTopic] = useState("General");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Keep the exact pending payload across a network retry. Once the draft
  // changes, a new operation gets a new key; failed responses never auto-send.
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  const recipients = useQuery<AdminChatRecipient[]>({
    queryKey: ["/api/admin/chat/recipients"], enabled: open, staleTime: 0,
  });
  const start = useMutation({
    mutationFn: async (payload: StartAdminChatInput) => {
      const res = await apiRequest("POST", "/api/admin/chat/start", payload);
      return res.json() as Promise<{ thread: { id: number } }>;
    },
    onSuccess: ({ thread }) => {
      // A failed inbox refresh must not invite sending the already-saved
      // message again. The parent will select it when its query refreshes.
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setOpen(false);
      onStarted(thread.id);
    },
    onError: (err: Error) => setError(err.message || "Could not start the chat. Please retry."),
    onSettled: () => { submitting.current = false; },
  });

  function begin() {
    setPartner(null); setSearch(""); setMode("general"); setTopic("General");
    setMessage(""); setError(""); attempt.current = null; start.reset(); setOpen(true);
  }
  function chooseMode(next: "general" | "referral") {
    if (topic === defaultTopic(mode)) setTopic(defaultTopic(next));
    if (!message.trim() || message === referralMessage) setMessage(next === "referral" ? referralMessage : "");
    setMode(next); setError("");
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partner || submitting.current || start.isPending || !message.trim() || !topic.trim()) return;
    const payload = { userId: partner.id, mode, topic: topic.trim(), message: message.trim() };
    const signature = JSON.stringify(payload);
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { signature, id: crypto.randomUUID() };
    }
    submitting.current = true; setError("");
    start.mutate({ ...payload, requestId: attempt.current.id });
  }
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const filtered = (recipients.data || []).filter(p =>
    normalize(`${p.name} ${p.email} ${p.businessName || ""}`).includes(normalize(search.trim())));

  return (
    <Dialog open={open} onOpenChange={next => { if (!start.isPending) setOpen(next); }}>
      <Button type="button" className="gap-1.5 min-h-11" onClick={begin} data-testid="button-admin-new-chat">
        <Plus className="h-4 w-4" /> New chat
      </Button>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-lg p-4 sm:p-6"
        data-testid="dialog-admin-new-chat"
        onInteractOutside={e => { if (start.isPending) e.preventDefault(); }}
        onEscapeKeyDown={e => { if (start.isPending) e.preventDefault(); }}>
        <DialogHeader className="text-left pr-7">
          <DialogTitle>New partner chat</DialogTitle>
          <DialogDescription>{partner ? "Review your message before sending." : "Choose an approved partner to start a conversation."}</DialogDescription>
        </DialogHeader>
        {!partner ? (
          <div className="space-y-3 min-w-0">
            <Label htmlFor="admin-chat-partner-search">Find a partner</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="admin-chat-partner-search" className="pl-9 min-h-11" autoComplete="off"
                placeholder="Name, clinic or email" value={search} onChange={e => setSearch(e.target.value)}
                data-testid="input-admin-chat-partner-search" />
            </div>
            {recipients.isLoading ? <Skeleton className="h-40 w-full" data-testid="loading-admin-chat-partners" /> :
              recipients.isError ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p>Could not load partners. Please try again.</p>
                  <Button variant="outline" className="min-h-11" onClick={() => void recipients.refetch()} data-testid="button-retry-chat-partners">Retry</Button>
                </div>
              ) : (
                <div className="max-h-[45dvh] overflow-y-auto space-y-1" aria-label="Available partners">
                  {filtered.map(p => (
                    <button key={p.id} type="button" onClick={() => { setPartner(p); setError(""); }}
                      className="w-full min-w-0 rounded-md border border-border px-3 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`button-new-chat-partner-${p.id}`}>
                      <span className="block font-medium text-sm [overflow-wrap:anywhere]">{p.name}</span>
                      {p.businessName && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.businessName}</span>}
                      <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.email}</span>
                    </button>
                  ))}
                  {!filtered.length && <p className="py-5 text-sm text-muted-foreground" data-testid="text-no-chat-partners">
                    {search ? "No matching partners. Try another name or clinic." : "No approved, active partners are available."}
                  </p>}
                </div>
              )}
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 min-w-0">
            <div className="min-w-0 rounded-md border border-border p-3">
              <p className="text-sm font-medium [overflow-wrap:anywhere]" data-testid="text-new-chat-recipient">{partner.name}</p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{partner.email}</p>
              <Button type="button" variant="ghost" className="mt-1 gap-1.5 min-h-11 -ml-2" disabled={start.isPending}
                onClick={() => setPartner(null)} data-testid="button-change-chat-partner"><ArrowLeft className="h-4 w-4" /> Change partner</Button>
            </div>
            <fieldset disabled={start.isPending} className="space-y-2 min-w-0">
              <legend className="text-sm font-medium mb-2">What would you like to do?</legend>
              <RadioGroup value={mode} onValueChange={v => chooseMode(v as "general" | "referral")} className="gap-1">
                <Label className="flex items-center gap-3 min-h-11 cursor-pointer font-normal" htmlFor="admin-chat-general">
                  <RadioGroupItem id="admin-chat-general" value="general" data-testid="radio-chat-general" /> General conversation
                </Label>
                <Label className="flex items-center gap-3 min-h-11 cursor-pointer font-normal" htmlFor="admin-chat-referral">
                  <RadioGroupItem id="admin-chat-referral" value="referral" data-testid="radio-chat-referral" /> Request a patient referral
                </Label>
              </RadioGroup>
            </fieldset>
            {mode === "referral" && <p className="text-sm text-muted-foreground" data-testid="text-new-chat-referral-help">
              The partner gets a form button in this chat. Once they submit it, this same conversation becomes the patient referral chat.
            </p>}
            <div className="space-y-1.5">
              <Label htmlFor="admin-new-chat-topic">Subject</Label>
              <Input id="admin-new-chat-topic" value={topic} onChange={e => setTopic(e.target.value)} required maxLength={160}
                disabled={start.isPending} data-testid="input-admin-chat-topic" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-new-chat-message">First message</Label>
              <Textarea id="admin-new-chat-message" value={message} onChange={e => setMessage(e.target.value)} required maxLength={5000}
                className="min-h-28" disabled={start.isPending} placeholder="Write your message to the partner..."
                data-testid="textarea-admin-first-message" />
            </div>
            {error && <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]" data-testid="text-start-chat-error">{error}</p>}
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)} disabled={start.isPending}
                data-testid="button-cancel-new-chat">Cancel</Button>
              <Button type="submit" className="min-h-11 gap-2" disabled={start.isPending || !message.trim() || !topic.trim()}
                data-testid="button-start-chat-send">{start.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start chat &amp; send</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
