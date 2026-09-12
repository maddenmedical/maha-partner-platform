// Content for the Partner Platform's own Privacy Policy and Terms of Use.
// Scoped to what THIS app actually processes (partner/student registration,
// referrals, chat, shop, education) — distinct from the general clinic
// policy at https://maha.clinic/privacy-policy/, which covers patients
// interacting directly with MAHA's own website and services.
//
// Data Controller: Vidvana d.o.o. Madden Medical e.U. builds, hosts and
// technically operates the Platform on Vidvana's behalf (processor).
//
// NOTE: This was drafted to be accurate and reasonably complete, but it is
// not a substitute for review by a Slovenian/EU data-protection lawyer
// before being treated as final — especially the liability and governing
// law sections in the Terms.

import { CURRENT_LEGAL_VERSION } from "@shared/legalVersion";

export { CURRENT_LEGAL_VERSION };

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

const LAST_UPDATED = CURRENT_LEGAL_VERSION;

export const PRIVACY_POLICY: LegalDocument = {
  title: "Privacy Policy",
  updated: LAST_UPDATED,
  intro: [
    "This Privacy Policy explains how we collect, use and protect personal data through the MAHA Partner Platform (the \"Platform\") — the registration, referral, chat, shop and education features used by partner clinics and Institute students.",
    "It is separate from, and specific to, this Platform. It does not cover the general maha.clinic website or patients who interact directly with MAHA outside the Platform — see the general MAHA Privacy Policy at maha.clinic/privacy-policy for that.",
  ],
  sections: [
    {
      heading: "1. Who is responsible for your data",
      paragraphs: [
        "Vidvana d.o.o., Slovenska cesta 54, 1000 Ljubljana, Slovenia (\"Vidvana\", \"MAHA\", \"we\", \"us\") is the data controller for personal data processed through the Platform.",
        "The Platform is built, hosted and technically operated by Madden Medical e.U. on Vidvana's behalf, acting as a data processor under arrangement with Vidvana.",
        "You can reach us about privacy matters at info@maha.si.",
      ],
    },
    {
      heading: "2. Who this Policy applies to",
      paragraphs: [
        "This Policy applies to partner clinics and their staff who register and use the Platform (\"Partners\"), and to Institute students who register for training or mentorship programmes (\"Students\").",
        "Patients whose details are submitted through a referral do not use or access the Platform themselves. Section 5 explains how their data is handled.",
      ],
    },
    {
      heading: "3. What personal data we collect",
      paragraphs: ["Depending on how you use the Platform, we collect:"],
      bullets: [
        "Account & registration data: name, professional prefix/suffix, email, username, phone number, business name, VAT number, profession, city, address, country, homepage/website URL, and — if you choose to upload one — a copy of your degree, licence or professional certification.",
        "Authentication data: your password, stored only as a one-way cryptographic hash, never in plain text; and, if you set it up, Face ID / Fingerprint (WebAuthn) sign-in data, which is generated and stored by your own device and never leaves it.",
        "Referral data you submit about a patient: first and last name, phone or email, a description of their case, urgency, optional notes and an optional attachment — see section 5 on special category data.",
        "Communications: messages and files you exchange with the MAHA team or other partners inside the Platform's chat.",
        "Shop & order data: products ordered and delivery details you provide. Payment card details are handled directly by our payment processor, Stripe — we never see or store your card number.",
        "Course & education data: which videos, classes or homework modules you access or submit, for Institute students.",
        "Technical data: login timestamps and basic device/browser information needed to keep your account secure.",
      ],
    },
    {
      heading: "4. Why we process this data, and our legal basis",
      paragraphs: [],
      bullets: [
        "To create and manage your account and provide the Platform's services (registration review, referrals, chat, shop, education) — necessary to perform our contract with you (Art. 6(1)(b) GDPR).",
        "Because you have given consent, for example to this Privacy Policy and our Terms of Use when registering (Art. 6(1)(a) GDPR).",
        "To meet legal or accounting obligations, e.g. invoicing for shop orders (Art. 6(1)(c) GDPR).",
        "To keep the Platform secure and prevent misuse (Art. 6(1)(f) GDPR — legitimate interest).",
      ],
    },
    {
      heading: "5. Referral (patient) data — special category health data",
      paragraphs: [
        "When you submit a patient referral, you provide us with health-related information about a third party (the patient), which is \"special category data\" under Art. 9 GDPR.",
        "We process this data on the basis of Art. 9(2)(h) GDPR (provision of health care) together with Art. 9(3) GDPR, because it is processed by, or under the responsibility of, a professional subject to an obligation of professional secrecy, for the purpose of coordinating the patient's care between you and the MAHA clinical team.",
        "As the referring partner, you confirm at the time of each referral that you are entitled to share the patient's information with us for this purpose, and that you have met your own professional and legal obligations towards the patient — including, where required, informing them that their information will be shared with MAHA/Vidvana d.o.o. for care coordination.",
        "We do not use referral data for any purpose other than coordinating the referred patient's care, and we do not contact the patient directly except as part of that care coordination.",
      ],
    },
    {
      heading: "6. Who we share your data with",
      paragraphs: [
        "We use the following providers to run the Platform. Each is required to protect your data appropriately and to process it only on our instructions. We do not sell your personal data, and we do not share it with third parties for their own marketing purposes.",
      ],
      bullets: [
        "Google Drive (Google Ireland Limited) — encrypted backups of Platform data.",
        "Resend — delivery of transactional emails (registration notices, referral notifications, password resets).",
        "Stripe — processing of shop order payments.",
        "WordPress / LearnDash (partner.maha.clinic) — hosting of course content for Institute students.",
        "Madden Medical e.U. — technical development, hosting and maintenance of the Platform, acting as our processor.",
        "The MAHA clinical and administrative team, to review registrations, coordinate referrals and fulfil orders.",
      ],
    },
    {
      heading: "7. International data transfers",
      paragraphs: [
        "Some of the providers listed above may process data outside the European Economic Area. Where this happens, we require appropriate safeguards to be in place, such as the EU-US Data Privacy Framework or standard contractual clauses, and we are working towards hosting the Platform's core infrastructure within the EU.",
      ],
    },
    {
      heading: "8. How long we keep your data",
      paragraphs: [
        "Account data is kept for as long as your account is active, and for a further period afterwards to meet legal, accounting or dispute-resolution needs (typically up to five years after your account is closed).",
        "Referral data is kept for as long as necessary to support the referred patient's ongoing care and for the retention periods required by applicable healthcare record-keeping rules.",
        "You can ask us to delete data sooner where the law allows it — see your rights below.",
      ],
    },
    {
      heading: "9. Cookies",
      paragraphs: [
        "The Platform uses a single strictly-necessary session cookie so you stay signed in. We do not use advertising, analytics or tracking cookies.",
      ],
    },
    {
      heading: "10. Your rights",
      paragraphs: [
        "Under the GDPR you have the right to access the data we hold about you; ask us to correct it; ask us to delete it; restrict or object to certain processing; and receive a copy of it in a portable format.",
        "To exercise any of these rights, contact us at info@maha.si.",
        "If you are not satisfied with our response, you may lodge a complaint with the Slovenian Information Commissioner (Informacijski pooblaščenec), Dunajska cesta 22, 1000 Ljubljana, Slovenia, or with the supervisory authority in your own country.",
      ],
    },
    {
      heading: "11. Changes to this Policy",
      paragraphs: [
        "We may update this Policy as the Platform evolves. If we make a material change, existing users will be asked to review and acknowledge the updated Policy the next time they sign in.",
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDocument = {
  title: "Terms of Use",
  updated: LAST_UPDATED,
  intro: [
    "These Terms govern your use of the MAHA Partner Platform (the \"Platform\"), operated on behalf of Vidvana d.o.o. and provided technically by Madden Medical e.U. By registering for or using the Platform, you agree to these Terms and to our Privacy Policy.",
  ],
  sections: [
    {
      heading: "1. Who can use the Platform",
      paragraphs: [
        "The Platform is for partner clinics, medical or dental professionals, and Institute students who register and are approved by the MAHA team. Registration is reviewed before an account is activated, and we may decline or suspend an account, including where we cannot verify your professional qualifications.",
      ],
    },
    {
      heading: "2. Your account",
      paragraphs: [],
      bullets: [
        "Keep your login credentials — including any Face ID / Fingerprint set up on your device — confidential, and do not share your account with anyone else.",
        "Keep the information in your profile accurate and up to date.",
        "You are responsible for all activity carried out under your account.",
      ],
    },
    {
      heading: "3. Patient referrals",
      paragraphs: [
        "You may only submit a patient referral where you are legally and professionally entitled to share the patient's information with MAHA/Vidvana d.o.o. for the purpose of coordinating their care, and where you have met your own obligations towards the patient — including, where required, informing them that their information will be shared for this purpose.",
        "You confirm this at the time of each referral, as described in our Privacy Policy. Referral information must be accurate to the best of your knowledge, and should not include more about the patient than is reasonably necessary for the referral.",
      ],
    },
    {
      heading: "4. Chat and communications",
      paragraphs: [
        "The chat feature is provided so you can coordinate referrals and ask questions of the MAHA team. Please use it professionally, and avoid sharing information about a patient that isn't relevant to their care.",
      ],
    },
    {
      heading: "5. Shop orders and payments",
      paragraphs: [
        "Orders placed through the Shop are subject to the pricing, availability and delivery terms shown at checkout. Payments are processed securely by Stripe; we do not store your payment card details.",
      ],
    },
    {
      heading: "6. Courses and educational content",
      paragraphs: [
        "Videos, classes and materials made available to Institute students are for your own professional development only. Please do not copy, redistribute, or share access credentials for this content with anyone outside the Institute programme.",
      ],
    },
    {
      heading: "7. Acceptable use",
      paragraphs: [
        "Do not use the Platform for any unlawful purpose, to submit false information, to attempt to access another user's account or data, or to interfere with the Platform's normal operation or security.",
      ],
    },
    {
      heading: "8. Availability and changes",
      paragraphs: [
        "We aim to keep the Platform available and reliable, but we do not guarantee uninterrupted access, and we may update, suspend or modify features from time to time, including with reasonable notice where a change materially affects you.",
      ],
    },
    {
      heading: "9. Liability",
      paragraphs: [
        "The Platform is provided to support — not replace — your own professional clinical judgement. Nothing in these Terms limits liability for death, personal injury, fraud, or anything else that cannot lawfully be limited. Otherwise, to the extent permitted by law, Vidvana d.o.o. and Madden Medical e.U. are not liable for indirect or consequential losses arising from your use of the Platform.",
      ],
    },
    {
      heading: "10. Ending your access",
      paragraphs: [
        "You may stop using the Platform at any time. We may suspend or terminate an account that breaches these Terms, misuses the referral or chat features, or is inactive for an extended period.",
      ],
    },
    {
      heading: "11. Governing law",
      paragraphs: [
        "These Terms are governed by the laws applicable to Vidvana d.o.o. as data controller (Slovenia) for matters concerning the processing of personal data, and otherwise by Austrian law, without prejudice to any mandatory consumer or data-protection protections you are entitled to in your own country.",
      ],
    },
    {
      heading: "12. Contact",
      paragraphs: ["Questions about these Terms can be sent to info@maha.si."],
    },
  ],
};
