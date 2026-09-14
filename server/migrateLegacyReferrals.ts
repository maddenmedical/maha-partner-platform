// One-time (safely re-runnable) import of the patient referrals that were
// already sitting in the old partner.maha.clinic "Patient Referral Form"
// (Contact Form 7 + Advanced CF7 DB) before this app existed. That plugin
// never exposed its submissions through the WordPress REST API, so unlike
// migrateLegacyPartners.ts this can't pull live — the user exported the
// Advanced CF7 DB entries to a spreadsheet and the real (non-test) rows are
// hardcoded below. See server/migrateLegacyPartners.ts for the sibling
// account/course/order importer this mirrors.
//
// For each row: create the referral, open its dedicated chat thread (kind
// "referral", same as the normal /api/referrals flow), and award the
// standard flat referral credit (see shared/schema.ts STANDING_POINTS.
// referral_submitted = 50, category "app_activity", no sourceId — matches
// the compliance rule that referral points never carry a per-referral
// pointer). Every row is marked emailNotified=true on both the referral and
// its chat thread so the background notification scheduler never emails
// anyone about these — historical data must never trigger a live partner
// email, full stop.
//
// Idempotency: matched by (partnerId, patientFirstName, patientLastName,
// createdAt) against existing referrals — re-running this after a partial
// run or a redeploy will only insert what's still missing.
import { db, storage } from "./storage";
import { users, referrals, chatThreads } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { STANDING_POINTS, STANDING_TIERS } from "@shared/schema";

type LegacyReferralRow = {
  // Email of the WP account that submitted the form. Used to find the
  // already-migrated partner account to attach this referral to.
  submitterEmail: string;
  // If true, the referral is imported but no standing points are awarded
  // (e.g. it was submitted from an internal MAHA staff address, not an
  // actual partner).
  skipPoints?: boolean;
  patientFirstName: string;
  patientLastName: string;
  patientContact: string;
  caseDescription: string;
  urgency: "Normal" | "Urgent";
  notes?: string | null;
  attachmentUrl?: string | null;
  // Original CF7 submit_time, "YYYY-MM-DD HH:MM:SS" (server-local on the old
  // site) — used as the historical createdAt so ordering/history is honest.
  submittedAt: string;
};

function combineCaseDescription(parts: Record<string, string | null | undefined>): string {
  const order: [string, string][] = [
    ["Concern", parts.concern ?? ""],
    ["Summary", parts.summary ?? ""],
    ["History", parts.history ?? ""],
    ["Medications", parts.medications ?? ""],
    ["Lab / imaging", parts.lab ?? ""],
    ["Requested action", parts.action ?? ""],
    ["Specific request", parts.specific ?? ""],
  ];
  return order
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([label, v]) => `${label}: ${v.trim()}`)
    .join("\n\n");
}

// Real (non-test) rows from the Advanced CF7 DB export of "Patient Referral
// Form", 2026-09-14. Test/placeholder rows (Lorem ipsum, test@test.com,
// markolampret@gmail.com, grega@vbg.si "g/ggg" and "grega/tet") are
// intentionally excluded per explicit instruction.
const LEGACY_REFERRALS: LegacyReferralRow[] = [
  {
    // Submitted as "info@drmaicc.com" — not an exact account match; user
    // confirmed crediting this to the same clinic as the other ICC referrals.
    submitterEmail: "dr.mai@drmaicc.com",
    patientFirstName: "Zahieh",
    patientLastName: "Awad",
    patientContact: "Dr.reemawad@gmail.com / 0506147787",
    caseDescription: combineCaseDescription({
      concern:
        "Patient had a head trauma, she's suffering from unexplained pain, dizziness and consciousness issues. Patient has amalgams that the referring doctor would like Dr. Perko to check with. Patient is willing to travel after the zoom consultation.",
      action: "Consultation & Advice; Shared Care / Co-Management",
      specific: "Amalgam removal. X-ray will be sent via email.",
    }),
    urgency: "Normal", // old form said "Soon"
    notes: "Patient DOB (as recorded on old form): 02/08/1953.",
    submittedAt: "2026-04-30 09:33:35",
  },
  {
    submitterEmail: "dr.mai@drmaicc.com",
    patientFirstName: "Mohammed",
    patientLastName: "AL Hammadi",
    patientContact: "myalhammadi66@hotmail.com / 971506613839",
    caseDescription: combineCaseDescription({
      summary:
        "Patient first presented in 2020 with complaints of gas and constipation. Initial management was conventional (laxatives, colon cleansing). Patient was a smoker but stopped. Food intolerance / heavy metal testing was done and assessed. Patient has shown partial compliance with treatment plans, following therapies intermittently. Symptoms have been fluctuating, with periods of improvement followed by recurrence, partly due to work travel affecting his routine.",
      action: "Consultation & Advice",
    }),
    urgency: "Normal", // old form said "Soon"
    notes: "Patient DOB (as recorded on old form): 22-02-1983.",
    submittedAt: "2026-03-28 14:23:33",
  },
  {
    // Submitted from an internal MAHA staff address, not a partner account —
    // imported for continuity but no referral points per user's decision.
    submitterEmail: "dusan@maha.si",
    skipPoints: true,
    patientFirstName: "Dušan",
    patientLastName: "Banović",
    patientContact: "dusan.banovic@gmail.com / +385912330323",
    caseDescription: combineCaseDescription({
      concern: "Regular check-up.",
      summary: "Patient requires regular check-ups and bite (occlusion) diagnostics, and — if needed — scaling (removal of tartar).",
      history: "N/A",
      medications: "Medications for high blood pressure.",
      action: "Patient consents for us to reach out proactively; Consultation & Advice",
    }),
    urgency: "Normal", // old form said "Soon"
    notes: "Patient travels from Zagreb. Referring: Dr Perko. Patient DOB (as recorded on old form): 03/03/1976.",
    attachmentUrl: "https://partner.maha.clinic/wp-content/uploads/advanced-cf7-upload/Banovic_Dusan_13102021_0959582026022405.zip",
    submittedAt: "2026-02-24 17:06:56",
  },
  {
    submitterEmail: "dr.mai@drmaicc.com",
    patientFirstName: "Hamda",
    patientLastName: "Al Mansoori",
    patientContact: "hmmuae@hotmail.com / 0507818755",
    caseDescription: combineCaseDescription({
      concern: "Heavy metals toxicity, post cancer, possibility of MS.",
      summary:
        "Past medical history significant for lymphoma diagnosed in 2002, treated successfully. In 2022 diagnosed with breast cancer, underwent chemotherapy. Recent MRI of the brain revealed multiple small T2/FLAIR white matter hyperintensities in the bilateral frontoparietal regions, some perpendicular to the surface, raising the possibility of demyelination including multiple sclerosis. Further neurological evaluation and correlation with clinical findings recommended.",
      lab: "https://wetransfer.com/downloads/03070a289b698bc954d077d0a6f9312420260216112029/f80b62bd62e1ab38dfedb28b048a919220260216112840/fa416d",
      action: "Consultation & Advice",
    }),
    urgency: "Normal", // old form said "Soon"
    notes: "Patient DOB (as recorded on old form): 19/4/1980.",
    submittedAt: "2026-02-21 16:47:09",
  },
  {
    submitterEmail: "dr.mai@drmaicc.com",
    patientFirstName: "AIia",
    patientLastName: "Al Dhaheri",
    patientContact: "mohamedr5332@gmail.com / 0506151314",
    caseDescription: combineCaseDescription({
      concern:
        "Patient presented to the clinic on 2025-12-20 with complaints of vascular tinnitus in the ear, palpitations, gastric discomfort, IBS, GERD, and retrosternal pain.",
      summary:
        "Began a full-body detox program on 2026-01-17. Following the detox, patient reported significant improvement — symptoms markedly decreased, feels more energetic overall. Bio-resonance scan shows virus and fungus in nasal cavity, affecting the 1st superior molar tooth on the right side. Referring doctor would like her evaluated by Dr. Perko for a dental consultation.",
      medications: "Still on detox supplements (Chlorella, probiotic, digestive enzymes, silver nasal spray, magnesium and vitamins).",
      lab: "https://wetransfer.com/downloads/2a43acaf54d86dd15f096c4b116fe26a20260217132829/9292242b4292ba7f35312e11be7c3f1e20260217133628/3522c5",
      action: "Consultation & Advice",
    }),
    urgency: "Normal", // old form said "Soon"
    notes: "Patient DOB (as recorded on old form): 29/12/1974.",
    submittedAt: "2026-02-21 15:53:24",
  },
  {
    submitterEmail: "suzanne@noidhealth.se",
    patientFirstName: "Svenn",
    patientLastName: "Christoffersson",
    patientContact: "svenn@hydroflow.se / +47 92092392",
    caseDescription: combineCaseDescription({
      concern:
        "Male patient with a chronic, treatment-resistant cough for several years, producing large amounts of mucus daily. Conventional care labelled it \"chronic bronchitis\" but the clinical picture does not match; cannot sleep lying down due to continuous coughing. Overall health and lifestyle excellent. Followed for 18 months; repeated biofunctional screenings show recurrent bacterial activation (mainly Streptococcus, Peptostreptococcus anaerobius, Mycoplasma pneumoniae) affecting the respiratory tract, vascular structures, head and neck tissues. 3D imaging revealed a malpositioned upper right wisdom tooth with suspected fluid communication into the sinus, together with a poorly healed previous extraction site — findings correlate with the chronic pulmonary symptoms. Imaging completed: OPG (panoramic X-ray), CBCT / 3D cone beam CT. Both indicate an abnormality involving the right upper wisdom tooth with possible sinus involvement, and an unclear dark area on the left mandible requiring further interpretation. Requesting full professional evaluation of all existing images (OPG + CBCT) and a complete CaviTau cavitation screening. Patient has just completed 20 HBOT sessions (twice daily) plus Papimi ion-induction therapy and is in ideal condition for surgical intervention if required.",
      action: "Specific Procedure (describe)",
      specific:
        "Full CaviTau cavitation and jawbone screening of upper and lower jaws, including evaluation of all tooth regions. Assess CBCT and OPG together with CaviTau findings to identify possible chronic bone infection, NICO/FDOJ, sinus communication related to the upper right wisdom tooth, and interpretation of the unclear dark mandibular area. Patient is prepared and ready for intervention as soon as possible.",
    }),
    urgency: "Urgent",
    notes: "Referring: Suzanne Lundborg, Noid Health – Biofunctional & Regenerative Health, Göteborg, Sweden. Patient DOB (as recorded on old form): 090760.",
    submittedAt: "2025-11-13 14:41:26",
  },
];

function parseSubmittedAt(s: string): number {
  // "YYYY-MM-DD HH:MM:SS" — treat as UTC to keep this deterministic
  // regardless of what timezone this script happens to run in.
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

export type LegacyReferralImportSummary = {
  totalRows: number;
  imported: number;
  skippedExisting: number;
  skippedNoPartnerMatch: { patientName: string; submitterEmail: string }[];
  pointsAwarded: { partnerEmail: string; totalPoints: number }[];
};

export async function runLegacyReferralImport(): Promise<LegacyReferralImportSummary> {
  console.log("=== Legacy referral import (partner.maha.clinic Patient Referral Form -> Partner Platform) ===\n");

  const summary: LegacyReferralImportSummary = {
    totalRows: LEGACY_REFERRALS.length,
    imported: 0,
    skippedExisting: 0,
    skippedNoPartnerMatch: [],
    pointsAwarded: [],
  };
  const pointsByEmail = new Map<string, number>();

  // Case-insensitive match -- account emails were typed by hand at
  // registration time (some old WP records show inconsistent casing, e.g.
  // "Suzanne@noidhealth.se") so an exact-case match would silently miss a
  // real account.
  const allUsers = db.select().from(users).all();
  for (const row of LEGACY_REFERRALS) {
    const partner = allUsers.find((u) => u.email.toLowerCase() === row.submitterEmail.toLowerCase());
    if (!partner) {
      console.log(`  ! no local account for ${row.submitterEmail} (${row.patientFirstName} ${row.patientLastName}) — skipping`);
      summary.skippedNoPartnerMatch.push({
        patientName: `${row.patientFirstName} ${row.patientLastName}`,
        submitterEmail: row.submitterEmail,
      });
      continue;
    }

    const createdAt = parseSubmittedAt(row.submittedAt);

    // Idempotency: same partner + same patient name + same historical
    // timestamp = the same row already imported on a prior run.
    const existing = db
      .select()
      .from(referrals)
      .where(
        and(
          eq(referrals.partnerId, partner.id),
          eq(referrals.patientFirstName, row.patientFirstName),
          eq(referrals.patientLastName, row.patientLastName),
          eq(referrals.createdAt, createdAt)
        )
      )
      .get();
    if (existing) {
      console.log(`  = already imported: ${row.patientFirstName} ${row.patientLastName} (partner #${partner.id})`);
      summary.skippedExisting++;
      continue;
    }

    const referral = db
      .insert(referrals)
      .values({
        partnerId: partner.id,
        patientFirstName: row.patientFirstName,
        patientLastName: row.patientLastName,
        patientContact: row.patientContact,
        caseDescription: row.caseDescription || "(no case description provided on original submission)",
        urgency: row.urgency,
        notes: `[Imported from the old partner.maha.clinic portal — originally submitted ${row.submittedAt} UTC]${row.notes ? "\n\n" + row.notes : ""}`,
        attachmentUrl: row.attachmentUrl ?? null,
        status: "New",
        // Already "notified" so the background scheduler never emails
        // anyone about this historical row.
        emailNotified: true,
        notifiedAt: createdAt,
        // Predates the new per-referral consent-attestation checkbox — leave
        // unset rather than fabricate an attestation that never happened.
        patientConsentAttestedAt: null,
        createdAt,
      })
      .returning()
      .get();

    db.insert(chatThreads)
      .values({
        userId: partner.id,
        userRole: "partner",
        topic: `Patient: ${referral.patientFirstName} ${referral.patientLastName}`,
        kind: "referral",
        referralId: referral.id,
        pendingReferralRequestedAt: null,
        pendingReferralRequestedByRole: null,
        emailNotified: true,
        notifiedAt: createdAt,
        ownerLastReadAt: null,
        adminLastReadAt: null,
        escalationSentForMessageId: null,
        archivedAt: null,
        reactivationRequestedAt: null,
        createdAt,
      })
      .run();

    if (!row.skipPoints) {
      const points = STANDING_POINTS.referral_submitted;
      try {
        const { newTierKey, clinicId } = await storage.awardStandingPoints({
          userId: partner.id,
          category: "app_activity",
          points,
          // Deliberately no sourceType/sourceId -- flat, one-time credit,
          // not tied back to this specific referral. Matches the exact
          // same call shape as the live /api/referrals route.
        });
        if (newTierKey) {
          const tier = STANDING_TIERS.find((t) => t.key === newTierKey);
          if (tier?.reward) {
            await storage.createStandingReward({
              userId: partner.id,
              tierKey: tier.key,
              rewardDescription: tier.reward,
              createdAt: Date.now(),
              clinicId,
            });
          }
        }
      } catch (e) {
        // Standing is a side-effect, never a reason to fail the import.
        console.error("awardStandingPoints failed during legacy referral import", e);
      }
      pointsByEmail.set(row.submitterEmail, (pointsByEmail.get(row.submitterEmail) ?? 0) + points);
    }

    console.log(`  + imported: ${row.patientFirstName} ${row.patientLastName} -> partner #${partner.id} (${row.submitterEmail})${row.skipPoints ? " [no points — internal submission]" : ""}`);
    summary.imported++;
  }

  summary.pointsAwarded = Array.from(pointsByEmail.entries()).map(([partnerEmail, totalPoints]) => ({ partnerEmail, totalPoints }));

  console.log(`\nDone: ${summary.imported} imported, ${summary.skippedExisting} already present, ${summary.skippedNoPartnerMatch.length} unmatched.\n`);
  return summary;
}
