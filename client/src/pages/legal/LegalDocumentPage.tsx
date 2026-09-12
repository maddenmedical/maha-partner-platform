import { Link, useLocation } from "wouter";
import { MahaWordmark } from "@/components/MahaLogo";
import { ArrowLeft } from "lucide-react";
import { PRIVACY_POLICY, TERMS_OF_USE, type LegalDocument } from "@/lib/legalContent";

// Renders either legal document. Reachable both signed-out (linked from
// Login/Register) and signed-in (linked from Account) — see App.tsx, where
// these routes sit outside the auth gate alongside /install and
// /forgot-password.
function LegalDocumentPage({ doc }: { doc: LegalDocument }) {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex flex-col items-center gap-2 mb-8">
          <MahaWordmark width={140} />
        </div>

        <button
          onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/"))}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
          data-testid="link-legal-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <article data-testid={`document-${doc.title.toLowerCase().replace(/\s+/g, "-")}`}>
          <h1 className="text-xl font-semibold mb-1" data-testid="text-legal-title">
            {doc.title}
          </h1>
          <p className="text-xs text-muted-foreground mb-6" data-testid="text-legal-updated">
            Last updated: {doc.updated}
          </p>

          <div className="flex flex-col gap-3 mb-8">
            {doc.intro.map((p, i) => (
              <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                {p}
              </p>
            ))}
          </div>

          <div className="flex flex-col gap-6">
            {doc.sections.map((section, i) => (
              <section key={i}>
                <h2 className="text-sm font-semibold mb-2">{section.heading}</h2>
                <div className="flex flex-col gap-2">
                  {section.paragraphs.map((p, j) => (
                    <p key={j} className="text-sm text-muted-foreground leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
                {section.bullets && (
                  <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5">
                    {section.bullets.map((b, j) => (
                      <li key={j} className="text-sm text-muted-foreground leading-relaxed">
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-10 pt-6 border-t flex flex-wrap gap-4">
            <Link href="/legal/privacy" className="text-xs text-primary underline underline-offset-2" data-testid="link-privacy-policy">
              Privacy Policy
            </Link>
            <Link href="/legal/terms" className="text-xs text-primary underline underline-offset-2" data-testid="link-terms-of-use">
              Terms of Use
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return <LegalDocumentPage doc={PRIVACY_POLICY} />;
}

export function TermsOfUsePage() {
  return <LegalDocumentPage doc={TERMS_OF_USE} />;
}
