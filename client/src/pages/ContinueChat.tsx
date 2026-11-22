import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { navigate } from "wouter/use-hash-location";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { setPendingThreadId, markInvitationSaved, carryInvitationDraft } from "@/lib/chatNav";
import { InvitationInstall } from "@/components/chat/InvitationInstall";
import {GuestAlerts} from "@/components/chat/GuestAlerts";
import {AttachmentNote,ChatTools,useChatViewport} from "@/components/chat/ChatFrame";
import {UserRoundPlus} from "lucide-react";
import {rememberGuest,forgetGuest,recentGuests} from "@/lib/guestDevice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InvitationConversation, InvitationFilters, useInvitationFilters } from "@/components/chat/InvitationConversation";

export default function ContinueChat({ params }: { params: { id: string; token?: string } }) {
  const { user, bootstrapping, loginWithUser } = useAuth();
  const filters=useInvitationFilters(params.id);
  const [started, setStarted] = useState(false), [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [nextStep, setNextStep] = useState<string | undefined>();
  const [keep, setKeep] = useState(false), [sentCode, setSentCode] = useState(false);
  const [email, setEmail] = useState(""), [code, setCode] = useState("");
  const [firstName, setFirstName] = useState(""), [lastName, setLastName] = useState(""), [prefix, setPrefix] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [moveCode,setMoveCode]=useState(""),[copied,setCopied]=useState(false);
  const [dismissed,setDismissed]=useState<{count:number;at:number}|null>(null),[clock,tick]=useState(Date.now);
  const [remember,setRemember]=useState(true);
  const [arrival,setArrival]=useState<"checking"|"start"|"restore"|"sign-in"|"sign-out"|"unavailable">(params.token?"checking":"start");
  const [matchCode,setMatchCode]=useState(""),[until,setUntil]=useState(0);
  const [toolsOpen,setToolsOpen]=useState(false);
  const [shared,setShared]=useState(false);
  useChatViewport(started&&!closed);
  const attempted = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const savePanel=useRef<HTMLElement>(null);
  useEffect(()=>{if(keep){savePanel.current?.scrollIntoView({block:"center"});emailInput.current?.focus({preventScroll:true});}},[keep]);
  const guidancePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) guidancePanel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
  const endpoint = `/api/guest-chat/${params.id}`;
  const chat = useQuery<{ topic: string; notifications:boolean; messages: { id: number; body: string; senderName: string; senderRole: string }[] }>({
    queryKey: [endpoint], enabled: started && !closed, refetchInterval: 4000, retry: false,
  });
  const outgoing=chat.data?.messages.filter(m=>m.senderRole==="guest").length||0;
  const nudge=outgoing>0 && (!dismissed || outgoing>=dismissed.count+5 || clock>=dismissed.at+600000);
  useEffect(()=>{if(!started||closed||keep||!dismissed)return;const timer=setInterval(()=>{if(document.visibilityState==="visible")tick(Date.now());},10000);return()=>clearInterval(timer);},[started,closed,keep,dismissed]);
  useEffect(()=>{if(moveCode){const timer=setTimeout(()=>{setMoveCode("");setCopied(false);},300000);return()=>clearTimeout(timer);}},[moveCode]);
  async function openMemberChat(threadId: number) {
    const response = await apiRequest("GET", "/api/auth/me");
    const account = await response.json();
    forgetGuest(params.id);
    queryClient.clear();
    carryInvitationDraft(threadId,conversation.current?.querySelector("textarea")?.value||"");
    markInvitationSaved(account.id);
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
    setKeep(false);setToolsOpen(false); setError(""); setNextStep(undefined);
    conversation.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }
  function checkPendingMedia() {
    if (conversation.current?.querySelector('[data-testid="invite-guest-pending-attachment"],[data-testid="invite-guest-reply-preview"],[aria-label="Stop recording"],[data-draft-media-busy="true"]'))
      throw new Error("Send or remove your pending attachment, recording or quoted reply before saving this chat. Your text draft stays here.");
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
      if (result.threadId) await openMemberChat(result.threadId); else {if(remember)rememberGuest(params.id);navigate(`/guest-chat/${params.id}`,{replace:true});}
    });
  }
  useEffect(() => {
    if(!bootstrapping&&params.token&&!attempted.current){
      attempted.current=true;
      void action(async()=>{
        try{
          const r=await apiRequest("POST",`${endpoint}/return`,{token:params.token});const result=await r.json();
          if(result.state==="shared"){queryClient.removeQueries({queryKey:[endpoint],exact:true});setShared(true);setStarted(true);return;}
          if(result.state==="member"){forgetGuest(params.id);setPendingThreadId(result.threadId);navigate("/chat",{replace:true});return;}
          if(result.state==="guest"){navigate(`/guest-chat/${params.id}`,{replace:true});return;}
          if(result.state==="restore"&&result.code){setMatchCode(result.code);setUntil(result.until);}
          setArrival(result.state);
        }catch(e){setArrival("unavailable");throw e;}
      });
    }else if (!bootstrapping && !params.token && !attempted.current) {
      attempted.current=true;
      void action(async()=>{const r=await apiRequest("POST",`${endpoint}/resume`,{});const {threadId}=await r.json();if(threadId&&user){forgetGuest(params.id);setPendingThreadId(threadId);navigate("/chat",{replace:true});return;}if(recentGuests().some(g=>g.id===params.id))rememberGuest(params.id);setStarted(true);});
    }
  }, [bootstrapping, user?.id]);
  async function requestRestore(){
    const r=await apiRequest("POST",`${endpoint}/restore`,{token:params.token});const result=await r.json();
    setMatchCode(result.code);setUntil(result.until);
  }
  async function checkRestore(){
    const r=await apiRequest("POST",`${endpoint}/restore/check`,{token:params.token});const result=await r.json();
    if(result.state==="guest"){if(remember)rememberGuest(params.id);setMatchCode("");navigate(`/guest-chat/${params.id}`,{replace:true});}
    else setNextStep("waiting-for-verification");
  }
  useEffect(()=>{
    if(!matchCode||started)return;
    let disposed=false,checking=false;
    const poll=async()=>{if(disposed||checking||document.visibilityState==="hidden")return;
      if(Date.now()>=until){setMatchCode("");setError("The matching code expired, not your chat. Request a new code here.");return;}
      checking=true;try{await checkRestore();}catch(e){if(!disposed){setMatchCode("");setError(e instanceof Error?e.message:"Please try again.");}}finally{checking=false;}
    };
    const timer=setInterval(poll,10000);return()=>{disposed=true;clearInterval(timer);};
  },[matchCode,started,until]);
  const active=started&&!closed&&!chat.isError;
  return <main className={active?"guest-chat-frame bg-background text-foreground":"min-h-dvh bg-background text-foreground px-4 py-6"}>
    <div className={active?"mx-auto flex h-full max-w-3xl min-w-0 flex-col overflow-hidden bg-card sm:border-x":"mx-auto flex max-w-2xl min-w-0 flex-col gap-4"}>
      {!active&&<header className="border-b pb-4"><p className="text-xl font-semibold tracking-widest text-primary">MAHA</p><h1 className="mt-2 text-xl font-semibold">Continue your conversation</h1></header>}
      {closed ? <div className="rounded-lg border p-5 space-y-3">
        <h2 className="font-semibold">Your conversation is safely retained by MAHA</h2>
        <p className="text-sm text-muted-foreground">You have not created an account. You can ask MAHA to connect this conversation to your account if you register later.</p>
      </div> : (!started&&!params.token || started&&chat.isError) ? <div className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="font-medium">{busy||bootstrapping?"Opening your chat…":"Return to your conversation"}</h2>
        {shared?<p>This shared chat is unavailable. Reopen the original link or contact MAHA.</p>:!busy&&!bootstrapping&&<><p className="text-sm">Open your original WhatsApp link and choose Restore this chat if this browser needs verification. If you moved the chat, open it in the new app. If you registered, sign in to your account.</p>
          <a className="underline text-sm" href="#/login">Sign in or enter a device code</a>
          <Button size="sm" variant="ghost" onClick={()=>{forgetGuest(params.id);navigate("/login");}}>Forget this chat on this device</Button></>}
      </div> : !started&&params.token&&arrival!=="start" ? <section className="rounded-lg border bg-card p-5 space-y-4">
        {arrival==="checking"?<h2>Opening your chat…</h2>:arrival==="restore"?<>
          <h2 className="font-semibold">Restore this chat</h2>
          <p>This is your original conversation. This browser needs to be verified before it can show your messages. You do not need to register.</p>
          {!matchCode?<Button disabled={busy} onClick={()=>action(requestRestore)}>Restore this chat</Button>:<>
            <p>Send this matching code to MAHA in your existing WhatsApp conversation. Ask MAHA to verify your identity there. The code alone cannot open the chat.</p>
            <p className="text-xl font-semibold tracking-wider" aria-label="Matching code">{matchCode}</p>
            <p className="text-sm">Keep this page open. After MAHA confirms, your messages will open here and the previous guest device will lose access. The code lasts 20 minutes; the conversation does not expire.</p>
            <Button variant="outline" disabled={busy} onClick={()=>action(checkRestore)}>Check approval</Button>
            {nextStep==="waiting-for-verification"&&<p role="status">Waiting for MAHA to verify this browser.</p>}
          </>}
        </>:arrival==="sign-in"?<><h2 className="font-semibold">Your chat is saved to a partner account</h2><a className="underline" href="#/login">Sign in to the linked account</a></>:arrival==="sign-out"?<><h2 className="font-semibold">This chat is not linked to the signed-in account</h2><p>Sign out or reopen your personal link in a separate browser. Do not use someone else’s account.</p></>:<><h2 className="font-semibold">This invitation could not be opened</h2><p>Check the link or contact MAHA in your original WhatsApp conversation.</p><Button variant="outline" onClick={()=>location.reload()}>Try again</Button></>}
      </section> : !started ? <div className="rounded-lg border bg-card p-5 space-y-4">
        <p>Talk to the MAHA team here. No password or account is needed to start.</p>
        <p className="text-sm text-muted-foreground">This invitation opens one private chat on this device. Register to save the conversation to your partner account. Please do not send identifiable patient information before verification.</p>
        <p className="text-xs text-muted-foreground">MAHA retains the conversation even if you do not register. Read the <a className="underline" href="#/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Reopen this chat on my device. Uncheck on a shared phone.</label>
        <Button onClick={begin} disabled={busy || bootstrapping} className="w-full">{busy ? "Opening…" : user?.role==="partner"?"Open in my signed-in partner account":"Start chat"}</Button>
      </div> : <>
        <header className="flex items-center gap-2 border-b px-3 py-1.5 shrink-0">
          <div className="mr-auto min-w-0"><p className="text-[10px] font-semibold tracking-widest text-primary">MAHA</p><h1 className="truncate text-base font-semibold">{chat.data?.topic || "Chat with MAHA"}</h1></div>
          {shared?<ChatTools label="Chat options"><InvitationFilters filters={filters}/><AttachmentNote/></ChatTools>:<ChatTools label="Chat options" open={toolsOpen} onOpenChange={v=>{setToolsOpen(v);if(!v)setKeep(false);}}>
        {!keep ? <div className="space-y-3">
          <p className="text-sm">{chat.data?.messages.some(m=>m.senderRole==="guest") ? "Your message is with MAHA. Keep this chat so you can return to the reply after leaving WhatsApp." : "You can chat first, or save this conversation to your partner account now."}</p>
          <GuestAlerts endpoint={endpoint} enabled={!!chat.data?.notifications}/>
          <InvitationFilters filters={filters}/><AttachmentNote/>
          <p className="text-xs text-muted-foreground">Already a partner? Use the same email. MAHA does not time out an opened guest chat. If you clear browser data, uninstall the app or lose this device, you may need MAHA’s help to return.</p>
          <details className="text-sm"><summary className="cursor-pointer underline">Move chat to the installed app</summary>
            <p className="my-2">Only needed if the app opens without your chat. On your own phone, get a code here, then choose “Move my guest chat to this app” on the app’s sign-in screen. Moving ends guest access in this browser; send any draft first. Never share the code.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={()=>action(async()=>{const r=await apiRequest("POST",`${endpoint}/device-code`,{});setMoveCode((await r.json()).code);setCopied(false);})}>{moveCode?"Replace device code":"Get one-time device code"}</Button>
            {moveCode&&<div className="mt-2 space-y-1"><p>Valid for five minutes: <code>{moveCode}</code></p><Button size="sm" variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(moveCode);setCopied(true);}catch{setError("Select and copy the displayed code.");}}}>{copied?"Copied":"Copy code"}</Button></div>}
          </details>
          <a className="text-xs underline" href="#/login" target="_blank" rel="noopener noreferrer">Use a different account</a>
          {recentGuests().some(g=>g.id===params.id)&&<Button size="sm" variant="ghost" onClick={()=>{forgetGuest(params.id);setRemember(false);}}>Remove from app launch on this device</Button>}
        </div> : <section ref={savePanel} className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Keep your conversation</h2>
          <p className="text-sm text-muted-foreground">Verify once to save this chat. Use your existing partner email, or add your name for a new account. You can turn on reply notifications afterwards.</p>
          {user?.role === "partner" ? <Button disabled={busy} onClick={() => action(async () => {
            checkPendingMedia();
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
                checkPendingMedia();
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
            await apiRequest("POST", `${endpoint}/decline`); forgetGuest(params.id);setClosed(true);
          })}>End guest access without registering</Button>
        </details>
        </ChatTools>}</header>
        {shared?<p className="shrink-0 border-b px-3 py-1.5 text-xs">Anyone with this link can read and reply. You are replying as a shared link guest.</p>:<div className="chat-primary-actions">
          {(!user||user.role==="partner")&&<Button size="sm" className="chat-register-action" onClick={()=>{setToolsOpen(true);setKeep(true);}}><UserRoundPlus aria-hidden="true"/>{user?"Keep in my account":"Register & keep this chat"}</Button>}
          <InvitationInstall guest/>
        </div>}
        {!shared&&!user&&nudge&&!keep&&<aside className="flex items-center gap-2 px-2 pt-1 shrink-0" data-testid="guest-register-nudge">
          <span className="text-xs font-medium">Your message is with MAHA. Register to keep your replies.</span>
          <Button size="sm" variant="ghost" onClick={()=>setDismissed({at:Date.now(),count:outgoing})}>Not now</Button></aside>}
        {!keep&&guidance}
        <div ref={conversation} className="min-h-0 flex flex-1"><InvitationConversation key={params.id} inviteId={params.id} shared={shared} filters={filters}/></div>
      </>}
      {!active && guidance}
    </div>
  </main>;
}
