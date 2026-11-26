import { useEffect, useRef, useState } from "react";
import { MahaWordmark } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

const INTRO_VIDEO_ID = "BrxPxQteNdA";
const DENTAL_VIDEO_ID = "0kbqOWvS_hY";
const MEDICAL_VIDEO_ID = "4yG86A9d8P8";

function YouTubeEmbed({ videoId, title, testId }: { videoId: string; title: string; testId: string }) {
  return <div className="rounded-lg overflow-hidden bg-muted aspect-video" data-testid={testId}>
    <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${videoId}`} title={title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
  </div>;
}

const prompts = ["Who would like to take part?", "Where are you starting from?", "What would you like to learn?", "Where can we send your offer?", "Does this look right?"];
export default function InstituteEnquiry() {
  const [step, go] = useState(0);
  const [attendance, attend] = useState<"individual" | "team" | "">("");
  const [size, setSize] = useState("");
  const [experience, setExperience] = useState("");
  const [goals, setGoals] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({preventScroll:true}); }, [step]);
  const team = attendance === "team";
  const optional = step === 1 || step === 2;
  const answers = [["Participation", team ? `Team of ${size}` : "Individual"], ["Clinical experience", experience.trim() || "Not answered"], ["Learning goals", goals.trim() || "Not answered"], ["Reply email", email]];
  const allowed = [!!attendance && (!team || (Number.isInteger(+size) && +size >= 2 && +size <= 9999)), true, true, !!email.trim(), true][step];
  async function advance(e: React.FormEvent) {
    e.preventDefault();
    if (!allowed || busy) return;
    setError("");
    if (step < 4) { go(step + 1); return; }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/public/institute-enquiries", {requestKey:key, attendance, groupSize:team ? +size : null, experience, goals, email});
      go(5);
    } catch (e) { setError(e instanceof Error ? e.message : "Your enquiry could not be sent. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-background text-foreground px-4 py-8 sm:py-14">
    <div className="mx-auto max-w-xl space-y-6">
      <MahaWordmark width={112} />
      <header className="space-y-2">
        <p className="text-xs tracking-widest uppercase text-muted-foreground">MAHA Institute</p>
        <h1 className="font-serif text-3xl sm:text-4xl">Plan your clinical training</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">Tell us about your practice and what you want to explore at the intersection of medicine and dentistry. The Institute team will use your answers to prepare a non-binding offer. No account is needed.</p>
      </header>
      <YouTubeEmbed videoId={INTRO_VIDEO_ID} title="MAHA Institute" testId="video-institute-intro" />
      <section className="rounded-xl border bg-card p-5 sm:p-7 space-y-4">
        {step < 5 ? <form onSubmit={advance} className="space-y-5">
          <p className="text-xs text-muted-foreground">{step < 4 ? `Question ${step + 1} of 4` : "Review your enquiry"}</p>
          <h2 ref={heading} tabIndex={-1} id="enquiry-prompt" className="text-xl font-medium outline-none">{prompts[step]}{optional && <span className="ml-2 align-middle inline-block rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground" data-testid="badge-optional">Optional</span>}</h2>
          {step === 0 && <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-labelledby="enquiry-prompt">
              {(["individual", "team"] as const).map(a => <Button type="button" key={a} variant={attendance === a ? "default" : "outline"} aria-pressed={attendance === a} onClick={() => attend(a)}>{a === "team" ? "My team" : "Just me"}</Button>)}
            </div>
            {team && <label className="block space-y-2 text-sm">About how many people would attend?<Input type="number" min={2} max={9999} required value={size} onChange={e => setSize(e.target.value)}/></label>}
            <p className="text-sm text-muted-foreground">Coming with colleagues? Ask for group pricing in your tailored offer.</p>
          </div>}
          {(step === 1 || step === 2) && <div className="space-y-2">
            <p className="text-sm text-muted-foreground" id="answer-hint">{step === 1 ? "What is your clinical role and experience, or which disciplines are represented in your team?" : "Which clinical question, skill or collaboration would you like the training to focus on?"} Please leave out patient information.</p>
            <p className="text-sm text-muted-foreground">This question is optional. You can skip it and tell us later.</p>
            <Textarea aria-labelledby="enquiry-prompt" aria-describedby="answer-hint" rows={4} maxLength={step === 1 ? 600 : 1000} value={step === 1 ? experience : goals} onChange={e => (step === 1 ? setExperience : setGoals)(e.target.value)} />
          </div>}
          {step === 3 && <div className="space-y-2">
            <label className="text-sm" htmlFor="offer-email">Contact email</label>
            <Input id="offer-email" required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/>
            <p className="text-sm text-muted-foreground">The Institute team can reply to this address about your enquiry. You are not booking a place or creating a partner account.</p>
          </div>}
          {step === 4 && <><dl className="space-y-3">{answers.map(([label,text]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words whitespace-pre-wrap text-sm">{text}</dd></div>)}</dl><p className="text-sm text-muted-foreground">Send these answers privately to the Institute team for a non-binding offer.</p></>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between gap-3 border-t pt-4">
            {step > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); go(step-1); }}>Back</Button>}
            <Button className="ml-auto" disabled={!allowed || busy}>{step === 4 ? (busy ? "Sending…" : "Send enquiry") : optional && !(step === 1 ? experience : goals).trim() ? "Skip" : "Continue"}</Button>
          </div>
        </form> : <><h2 ref={heading} tabIndex={-1} className="text-xl font-medium">Your enquiry is with the Institute team.</h2>
          <p className="text-sm">We’ll reply by email about your training and a non-binding offer. No place has been booked and no account has been created.</p>
          <p className="text-sm text-muted-foreground">If you also want platform access, you can <a className="underline" href="#/register">register separately</a>. The usual approval process applies.</p></>}
      </section>
      <section className="space-y-4" aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="font-serif text-2xl">Explore the modules</h2>
        <div className="space-y-2"><h3 className="text-sm font-medium">Dental</h3><YouTubeEmbed videoId={DENTAL_VIDEO_ID} title="MAHA Institute Dental Modules" testId="video-institute-dental" /></div>
        <div className="space-y-2"><h3 className="text-sm font-medium">Medical</h3><YouTubeEmbed videoId={MEDICAL_VIDEO_ID} title="MAHA Institute Non Dental Modules" testId="video-institute-medical" /></div>
      </section>
      <footer className="text-xs text-muted-foreground"><a className="underline" href="#/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></footer>
    </div>
  </main>;
}
