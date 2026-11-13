import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { navigate } from "wouter/use-hash-location";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { setPendingThreadId } from "@/lib/chatNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InvitationConversation } from "@/components/chat/InvitationConversation";

export default function ContinueChat({ params }: { params: { id: string; token: string } }) {
  const { user, bootstrapping, loginWithUser } = useAuth();
  const [started, setStarted] = useState(false), [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [nextStep, setNextStep] = useState<string | undefined>();
  const [keep, setKeep] = useState(false), [sentCode, setSentCode] = useState(false);
  const [email, setEmail] = useState(""), [code, setCode] = useState("");
  const [firstName, setFirstName] = useState(""), [lastName, setLastName] = useState(""), [prefix, setPrefix] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const attempted = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const guidancePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) guidancePanel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
  const endpoint = `/api/guest-chat/${params.id}`;
  const chat = useQuery<{ topic: string; messages: { id: number; body: string; senderName: string; senderRole: string }[] }>({
    queryKey: [endpoint], enabled: started && !closed, refetchInterval: 4000, retry: false,
  });
  async function openMemberChat(threadId: number) {
    const response = await apiRequest("GET", "/api/auth/me");
    const account = await response.json();
    queryClient.clear();
    flushSync(() => loginWithUser(account));
    setPendingThreadId(threadId); navigate("/chat", { replace: true });
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNextStep(undefined);
    try { await fn(); } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
      setNextStep((err as { nextStep?: string })?.nextStep);
    }
    finally { setBusy(false); }
  }
  function returnToConversation() {
    setKeep(false); setError(""); setNextStep(undefined);
    conversation.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    conversation.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }
  const guidance = error && <div ref={guidancePanel} role="alert" className="rounded-lg border border-destructive p-3 space-y-3 text-sm" data-testid="guest-account-guidance">
    <p className="text-destructive">{error}</p>
    {nextStep && <p>Your messages remain in this conversation. You can keep chatting while this is resolved.</p>}
    <div className="flex flex-wrap gap-2">
      {nextStep === "sign-in" && <Button asChild variant="outline" className="whitespace-normal h-auto min-h-9">
        <a href="#/" target="_blank" rel="noopener noreferrer">Open existing account (new tab)</a>
      </Button>}
      {(nextStep === "sign-in" || nextStep === "check-email") && <Button variant="outline" onClick={() => {
        setEmail(""); setSentCode(false); setCode(""); setError(""); setNextStep(undefined); emailInput.current?.focus();
      }}>Use a different email</Button>}
      {nextStep && <Button variant="outline" onClick={returnToConversation}>Continue chatting</Button>}
    </div>
  </div>;
  async function begin() {
    await action(async () => {
      const response = await apiRequest("POST", `${endpoint}/start`, { token: params.token });
      const result = await response.json();
      if (result.threadId) await openMemberChat(result.threadId); else setStarted(true);
    });
  }
  useEffect(() => {
    if (!bootstrapping && user?.role === "partner" && !attempted.current) {
      attempted.current = true; void begin();
    }
  }, [bootstrapping, user?.id]);
  return <main className="min-h-dvh bg-background text-foreground px-4 py-6">
    <div className="mx-auto flex max-w-2xl min-w-0 flex-col gap-4">
      <header className="border-b pb-4"><p className="text-xl font-semibold tracking-widest text-primary">MAHA</p><h1 className="mt-2 text-xl font-semibold">Continue your conversation</h1></header>
      {closed ? <div className="rounded-lg border p-5 space-y-3">
        <h2 className="font-semibold">Your conversation is safely retained by MAHA</h2>
        <p className="text-sm text-muted-foreground">You have not created an account. You can ask MAHA to connect this conversation to your account if you register later.</p>
      </div> : !started ? <div className="rounded-lg border bg-card p-5 space-y-4">
        <p>Talk to the MAHA team here. No password or account is needed to start.</p>
        <p className="text-sm text-muted-foreground">This private invitation opens one temporary chat on this browser. Afterwards, verify your email to keep the conversation and access the partner platform. Please do not send identifiable patient information before verification.</p>
        <p className="text-xs text-muted-foreground">MAHA retains the conversation even if you do not register. Read the <a className="underline" href="#/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
        <Button onClick={begin} disabled={busy || bootstrapping} className="w-full">{busy ? "Opening…" : "Start chat"}</Button>
      </div> : <>
        <h2 className="font-medium">{chat.data?.topic || "Chat with MAHA"}</h2>
        <div ref={conversation}><InvitationConversation key={params.id} inviteId={params.id} /></div>
        {!keep ? <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm">Finished chatting? Keep this conversation in your partner account. Your invitation includes approval; no password is required.</p>
          <Button variant="outline" className="w-full" onClick={() => setKeep(true)}>Keep this chat</Button>
        </div> : <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Keep your conversation</h2>
          <p className="text-sm text-muted-foreground">Already a partner? Use your existing email. Otherwise, enter your name to create your approved account.</p>
          {user?.role === "partner" ? <Button disabled={busy} onClick={() => action(async () => {
            const response = await apiRequest("POST", `${endpoint}/keep`); await openMemberChat((await response.json()).threadId);
          })}>Keep in my signed-in account</Button> : <>
            <Label htmlFor="guest-email">Email address</Label>
            <Input ref={emailInput} id="guest-email" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setSentCode(false); setCode(""); setError(""); setNextStep(undefined); }} />
            <Button variant="outline" disabled={busy || !email.includes("@")} onClick={() => action(async () => {
              await apiRequest("POST", `${endpoint}/send-code`, { email }); setSentCode(true);
            })}>{sentCode ? "Send a new code" : "Email me a verification code"}</Button>
            {sentCode && <>
              <p className="text-sm">Check your email for the six-digit code. It is valid for 10 minutes.</p>
              <Label htmlFor="guest-code">Verification code</Label><Input id="guest-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} />
              <Label htmlFor="guest-prefix">Title (optional)</Label><Input id="guest-prefix" value={prefix} onChange={e => setPrefix(e.target.value)} />
              <Label htmlFor="guest-first">First name (new accounts)</Label><Input id="guest-first" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} />
              <Label htmlFor="guest-last">Last name (new accounts)</Label><Input id="guest-last" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} />
              <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={acceptedLegal} onChange={e => setAcceptedLegal(e.target.checked)} />
                <span>I accept the <a className="underline" href="#/legal/terms" target="_blank" rel="noopener">Terms of Use</a> and acknowledge the <a className="underline" href="#/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
              <Button className="w-full" disabled={busy || !acceptedLegal || code.length !== 6} onClick={() => action(async () => {
                const response = await apiRequest("POST", `${endpoint}/verify`, { code, firstName, lastName, prefix, acceptedLegal });
                await openMemberChat((await response.json()).threadId);
              })}>Verify and keep my chat</Button>
            </>}
          </>}
          {guidance}
          <Button variant="ghost" disabled={busy} onClick={returnToConversation}>Return to conversation</Button>
        </section>}
        <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">I do not want to keep access</summary>
          <p className="my-3">This ends your guest session. MAHA will retain the chat for its admins and can connect it later if you register. It does not delete the conversation.</p>
          <Button variant="outline" disabled={busy} onClick={() => action(async () => {
            await apiRequest("POST", `${endpoint}/decline`); setClosed(true);
          })}>End guest access without registering</Button>
        </details>
      </>}
      {(!started || !keep || closed) && guidance}
    </div>
  </main>;
}
