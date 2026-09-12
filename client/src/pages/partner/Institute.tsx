import { Mail, Users2, Layers, BookOpen, Stethoscope, Wrench, ArrowRight } from "lucide-react";
import statsImage from "@/assets/brand/stats-institute-perko.jpg";
import perkoImage from "@/assets/brand/perko-microscope-solo.jpg";
import { MahaLogo } from "@/components/MahaLogo";

const APPLY_MAILTO =
  "mailto:education@maha.clinic?subject=" +
  encodeURIComponent("MAHA Institute — Application") +
  "&body=" +
  encodeURIComponent(
    "Hello MAHA Institute team,\n\nI would like to apply for a place. A little about me:\n\nBackground: \nClinical focus: \nWhat I want to change in my practice: \n\nThank you,\n"
  );

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

function ApplyButton({ className = "", testId }: { className?: string; testId: string }) {
  return (
    <a
      href={APPLY_MAILTO}
      className={
        "inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium px-5 py-2.5 hover-elevate active-elevate-2 " +
        className
      }
      data-testid={testId}
    >
      <Mail className="h-4 w-4" /> Apply for a place
    </a>
  );
}

export default function Institute() {
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

      {/* Stats visual */}
      <section className="w-full">
        <img
          src={statsImage}
          alt="90% of your patients have gum inflammation, 60–80% have gut dysbiosis, 50% have periodontal infections, 50% have root canals"
          className="w-full h-auto object-cover"
          data-testid="img-institute-stats"
        />
      </section>

      {/* A Mentorship, Not a Course */}
      <section className="bg-primary/15">
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
                <div className="h-9 w-9 rounded-md bg-background/70 flex items-center justify-center shrink-0">
                  <point.icon className="h-4.5 w-4.5 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{point.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{point.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-background/60 p-4">
            <p className="text-sm font-semibold">Applying for a Place</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Write to{" "}
              <a href={APPLY_MAILTO} className="text-foreground underline underline-offset-2" data-testid="link-apply-email-inline">
                education@maha.clinic
              </a>{" "}
              with your background, your clinical focus and what you want to change in your practice. We compose
              each group individually and agree the schedule with its participants.
            </p>
          </div>
        </div>
      </section>

      {/* Perko image break */}
      <section className="w-full">
        <img
          src={perkoImage}
          alt="Dr. Perko examining a sample under a clinical microscope"
          className="w-full h-48 object-cover"
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

      {/* Closing CTA */}
      <section className="bg-foreground text-background">
        <div className="max-w-2xl mx-auto w-full px-4 py-10 flex flex-col gap-5">
          <h2 className="font-serif text-xl" data-testid="text-cta-heading">
            Ready to Think Differently?
          </h2>
          <p className="text-sm text-background/70 leading-relaxed">
            Write to education@maha.clinic with your name, your clinical focus and the cases you would like to work
            on. We will discuss your goals and place you in a group that fits your level and your ambitions.
          </p>
          <ApplyButton className="self-start" testId="button-apply-cta" />
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
            <a href={APPLY_MAILTO} className="text-xs text-primary" data-testid="link-apply-email-footer">
              education@maha.clinic
            </a>
          </div>
          <ApplyButton testId="button-apply-footer" />
        </div>
      </section>
    </div>
  );
}
