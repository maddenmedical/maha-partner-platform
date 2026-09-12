import { useState } from "react";
import { MessageCircle, Users2, Layers, BookOpen, Stethoscope, Wrench, Play } from "lucide-react";
import teamProcedureImage from "@/assets/brand/institute-team-procedure.jpg";
import diagnosticHandsImage from "@/assets/brand/institute-diagnostic-hands.jpg";
import { MahaLogo } from "@/components/MahaLogo";
import { InstituteApplyChat } from "@/components/institute/InstituteApplyChat";

const INTRO_VIDEO_ID = "BrxPxQteNdA";
const MEDICAL_VIDEO_ID = "4yG86A9d8P8";
const DENTAL_VIDEO_ID = "0kbqOWvS_hY";

const stats = [
  { value: "90%", label: "of your patients have gum inflammation" },
  { value: "60\u201380%", label: "have gut dysbiosis" },
  { value: "50%", label: "have periodontal infections" },
  { value: "50%", label: "have root canals" },
];

const mentorshipPoints = [
  {
    icon: Users2,
    title: "Two to Four Participants",
    body: "Every group is limited to two and never exceeds four carefully selected clinicians. Nothing is delivered to an audience — everything is discussed, questioned and applied.",
  },
  {
    icon: Layers,
    title: "Learning Blocks, Not Lectures",
    body: "Instead of a fixed sequence of lectures, teaching is organised in broad blocks of approximately 35–40 academic hours (one academic hour = 45 minutes), shaped around the group.",
  },
  {
    icon: BookOpen,
    title: "Your Knowledge, Your Cases",
    body: "Content is adapted to your existing knowledge, your clinical interests, your patient cases and the concepts you want to introduce into your own practice. We work with MAHA cases and with the cases you bring.",
  },
  {
    icon: Stethoscope,
    title: "Live Clinical Immersion",
    body: "Three to five days in the clinic with Dr. Perko and the MAHA team give you insight into the complete patient journey: diagnostics, surgery, supportive therapies, laboratory work and follow-up.",
  },
  {
    icon: Wrench,
    title: "Implementation, Not Information",
    body: "You receive practical support in transferring what you learn into your own clinical environment — protocols, workflows and decision-making you can use the week after.",
  },
];

const pillars = [
  {
    number: "01",
    title: "Periodontics & Endodontics",
    body: "How periodontal and endodontic conditions influence systemic inflammation and overall health — diagnostics, treatment planning and long-term clinical management.",
  },
  {
    number: "02",
    title: "Osteoimmunology",
    body: "Bone, the immune system, chronic inflammation and healing, including FDOJ/NICO, diagnostic approaches and the clinical relevance of immune signalling.",
  },
  {
    number: "03",
    title: "Materials & Biocompatibility",
    body: "How materials interact with the individual patient: biocompatibility, completely metal-free dentistry, ceramic implantology and biologically responsible selection.",
  },
  {
    number: "04",
    title: "Function with Esthetics",
    body: "Occlusion, temporomandibular relationships and digital diagnostics. Esthetics is not a separate cosmetic goal, but the visible result of biologically sound treatment.",
  },
];

const leaveWith = [
  {
    title: "A method of clinical thinking",
    body: "Not lecture notes — a structured way of reasoning across disciplinary boundaries.",
  },
  {
    title: "Practical protocols",
    body: "Diagnostic and therapeutic workflows you can apply in your own practice immediately.",
  },
  {
    title: "A realistic plan",
    body: "A concrete plan for developing your practice, supported beyond the final day.",
  },
];

function ApplyButton({ className = "", testId, onClick }: { className?: string; testId: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium px-5 py-2.5 hover-elevate active-elevate-2 " +
        className
      }
      data-testid={testId}
    >
      <MessageCircle className="h-4 w-4" /> Start Your Application
    </button>
  );
}

function YouTubeEmbed({ videoId, title, testId }: { videoId: string; title: string; testId: string }) {
  return (
    <div className="rounded-lg overflow-hidden bg-muted aspect-video" data-testid={testId}>
      <iframe
        className="w-full h-full"
        src={`https://www.youtube.com/embed/${videoId}`}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

export default function Institute() {
  const [applyOpen, setApplyOpen] = useState(false);

  return (
    <div className="flex flex-col" data-testid="page-institute">
      {/* Hero */}
      <section className="px-4 pt-6 pb-5 max-w-2xl mx-auto w-full">
        <MahaLogo size={30} className="text-primary mb-4" />
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground" data-testid="text-institute-eyebrow">
          Personalised Clinical Mentorship
        </p>
        <h1 className="font-serif text-2xl leading-tight mt-2" data-testid="text-institute-title">
          MAHA Institute for Integrative Medicine &amp; Dentistry
        </h1>
        <p className="font-serif text-lg text-muted-foreground mt-1">The Oral–Systemic Connection</p>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          Not another dental course. Two to four carefully selected clinicians work directly with Dr. Perko and the
          MAHA team, in learning blocks built around their own patients. These are root causes sitting in your
          waiting room right now — not coincidences.
        </p>
      </section>

      {/* Intro video */}
      <section className="max-w-2xl mx-auto w-full px-4 pb-6">
        <YouTubeEmbed videoId={INTRO_VIDEO_ID} title="MAHA Institute" testId="video-institute-intro" />
      </section>

      {/* Stats */}
      <section className="bg-primary/15">
        <div className="max-w-2xl mx-auto w-full px-4 py-8 grid grid-cols-2 gap-5">
          {stats.map((stat) => (
            <div key={stat.label} data-testid={`stat-institute-${stat.label.slice(0, 12).toLowerCase().replace(/[^a-z]+/g, "-")}`}>
              <p className="font-serif text-3xl text-primary tabular-nums">{stat.value}</p>
              <p className="text-sm text-foreground/80 mt-1 leading-snug">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* A Mentorship, Not a Course */}
      <section className="bg-card">
        <div className="max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
          <div>
            <h2 className="font-serif text-xl" data-testid="text-mentorship-heading">
              A Mentorship, Not a Course
            </h2>
            <div className="h-px bg-foreground/15 mt-3" />
          </div>
          <div className="flex flex-col gap-5">
            {mentorshipPoints.map((point) => (
              <div key={point.title} className="flex gap-3" data-testid={`row-mentorship-${point.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <point.icon className="h-4.5 w-4.5 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{point.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{point.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-primary/10 p-4">
            <p className="text-sm font-semibold">Applying for a Place</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              No forms, no emails to write — just answer a few quick questions in chat and one of our admins will
              personally continue the conversation with you to agree the details.
            </p>
            <ApplyButton className="mt-3" testId="button-apply-inline" onClick={() => setApplyOpen(true)} />
          </div>
        </div>
      </section>

      {/* Team procedure image break */}
      <section className="w-full">
        <img
          src={teamProcedureImage}
          alt="The MAHA clinical team collaborating during a procedure"
          className="w-full h-64 sm:h-80 object-cover object-center"
          data-testid="img-institute-perko"
        />
      </section>

      {/* Four Clinical Pillars */}
      <section className="max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        <div>
          <h2 className="font-serif text-xl" data-testid="text-pillars-heading">
            Four Clinical Pillars
          </h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            One overarching theme, explored through four closely interconnected clinical fields — always within the
            same patient.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pillars.map((pillar) => (
            <div
              key={pillar.number}
              className="rounded-lg border border-card-border bg-card p-4"
              data-testid={`card-pillar-${pillar.number}`}
            >
              <span className="text-xs font-semibold text-primary tabular-nums">{pillar.number}</span>
              <p className="text-sm font-semibold mt-1">{pillar.title}</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{pillar.body}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm font-semibold">Integration, Not Isolation</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            These are not four separate subjects. The value of the MAHA Institute lies in showing how all four
            interact in the same patient, and how they combine into one coherent diagnostic and therapeutic approach.
          </p>
        </div>
      </section>

      {/* Diagnostic hands image break */}
      <section className="w-full">
        <img
          src={diagnosticHandsImage}
          alt="Hands-on diagnostic testing at the MAHA clinic"
          className="w-full h-64 sm:h-80 object-cover object-center"
          data-testid="img-institute-handshake"
        />
      </section>

      {/* Videos by specialty */}
      <section className="max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5" /> See the Modules in Action
          </p>
          <h2 className="font-serif text-xl mt-1" data-testid="text-videos-heading">
            Built for Your Specialty
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="flex flex-col gap-2">
            <YouTubeEmbed videoId={MEDICAL_VIDEO_ID} title="MAHA Institute Non Dental Modules" testId="video-institute-medical" />
            <p className="text-xs font-medium text-muted-foreground">For Medical Professionals</p>
          </div>
          <div className="flex flex-col gap-2">
            <YouTubeEmbed videoId={DENTAL_VIDEO_ID} title="MAHA Institute Dental Modules" testId="video-institute-dental" />
            <p className="text-xs font-medium text-muted-foreground">For Dental Professionals</p>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-foreground text-background">
        <div className="max-w-2xl mx-auto w-full px-4 py-10 flex flex-col gap-5">
          <h2 className="font-serif text-xl" data-testid="text-cta-heading">
            Ready to Think Differently?
          </h2>
          <p className="text-sm text-background/70 leading-relaxed">
            Answer a few quick questions in chat about your background, your clinical focus and the cases you would
            like to work on. We will discuss your goals and place you in a group that fits your level and your
            ambitions.
          </p>
          <ApplyButton className="self-start" testId="button-apply-cta" onClick={() => setApplyOpen(true)} />
        </div>
      </section>

      <section className="max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">What You Leave With</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {leaveWith.map((item) => (
            <div key={item.title} data-testid={`card-leave-with-${item.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
              <div className="h-px w-8 bg-primary mb-2" />
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>

        <blockquote className="border-l-2 border-primary pl-4 py-1" data-testid="text-perko-quote">
          <p className="font-serif text-lg leading-snug">
            "The most important result is that our first participants implemented a large part of what they learned
            directly into their everyday practice."
          </p>
          <p className="text-xs text-muted-foreground mt-2 uppercase tracking-wide">Dr. Perko, MAHA Institute</p>
        </blockquote>

        <div className="flex flex-col items-center gap-3 pt-4 pb-2 text-center border-t border-border">
          <MahaLogo size={26} className="text-primary" />
          <div>
            <p className="text-sm font-medium">MAHA</p>
            <p className="text-xs text-muted-foreground">Slovenska cesta 54, 1000 Ljubljana, Slovenija</p>
          </div>
          <ApplyButton testId="button-apply-footer" onClick={() => setApplyOpen(true)} />
        </div>
      </section>

      <InstituteApplyChat open={applyOpen} onOpenChange={setApplyOpen} />
    </div>
  );
}
