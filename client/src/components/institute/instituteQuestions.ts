// MAHA Institute application questions, taken verbatim from the "MAHA
// Institute: student assessment form" Google Form -- minus the timing/
// availability question (dates are now agreed later, in chat, with an admin).
// Used to drive the in-app chat questionnaire on the partner-side Institute
// page (client/src/pages/partner/Institute.tsx).

export type Question =
  | { id: string; type: "text"; label: string; helper?: string; long?: boolean }
  | { id: string; type: "choice"; label: string; helper?: string; options: string[] }
  | { id: string; type: "multi"; label: string; helper?: string; options: string[] }
  | { id: string; type: "scale"; label: string; helper?: string; min: number; max: number; minLabel: string; maxLabel: string };

export const MEDICAL_QUESTIONS: Question[] = [
  { id: "fullName", type: "text", label: "Full name" },
  {
    id: "degrees",
    type: "text",
    label: "Degree(s)",
    helper: "e.g. MD, Osteopathy, Heilpraktiker, Naturopath, Bioresonance Therapist, etc.",
  },
  { id: "country", type: "text", label: "Country of practice" },
  {
    id: "journeyStage",
    type: "text",
    label: "Where are you in your professional journey right now?",
    helper: "Student, early practice, established clinician, educator, specialist?",
  },
  {
    id: "labDiagnostics",
    type: "text",
    long: true,
    label: "Do you use laboratory diagnostics in your clinical decision-making?",
    helper: "If yes, which ones? If no, what is the main barrier \u2014 knowledge, logistics, cost, or belief?",
  },
  {
    id: "frustration",
    type: "text",
    long: true,
    label: "What is currently your biggest clinical frustration?",
    helper: "Be specific.",
  },
  { id: "strength", type: "text", long: true, label: "What do you believe you do exceptionally well?" },
  { id: "topicClarity", type: "text", long: true, label: "What topic do you most want clarity on during this course?" },
  {
    id: "expectPerko",
    type: "text",
    long: true,
    label: "What do you expect from Dr. Perko as a lecturer?",
    helper: "Protocols? Research depth? Practical shortcuts? Diagnostic education? Inspiration? Critical debate?",
  },
  {
    id: "lastCase",
    type: "text",
    long: true,
    label: "What was the last case that kept you awake at night?",
    helper: "Complication? Systemic link you couldn't explain?",
  },
  {
    id: "dentalReferral",
    type: "choice",
    label: "What do you do when you wish for your patient to receive dental care?",
    options: [
      "I refer to a specific dental specialist I trust.",
      "I recommend a number of dental specialists.",
      "I explain to the patient how to pick a good dental specialist.",
      "I tell the patient to go to their regular dental specialist.",
    ],
  },
];

export const DENTAL_QUESTIONS: Question[] = [
  {
    id: "modules",
    type: "multi",
    label: "Which modules would you be interested in?",
    options: [
      "Periodontal Medicine & Inflammation",
      "Endodontics & Biomaterials",
      "Functional & Structural Dentistry",
      "Esthetic Dentistry & Clinical Excellence",
      "Combi-Package of all 4 modules",
    ],
  },
  { id: "fullName", type: "text", label: "Full name" },
  { id: "degrees", type: "text", label: "Degrees", helper: "e.g. DDS, DMD, BDS, BDent, Dr. med. dent" },
  { id: "country", type: "text", label: "Country of practice" },
  {
    id: "journeyStage",
    type: "text",
    label: "Where are you in your professional journey right now?",
    helper: "Student, early practice, established clinician, educator, specialist?",
  },
  {
    id: "frustration",
    type: "text",
    long: true,
    label: "What is currently your biggest clinical frustration?",
    helper: "Be specific.",
  },
  { id: "avoidProcedure", type: "text", long: true, label: "What procedure do you avoid \u2014 and why?" },
  { id: "strength", type: "text", long: true, label: "What do you believe you do exceptionally well?" },
  { id: "topicClarity", type: "text", long: true, label: "What topic do you most want clarity on during this course?" },
  { id: "drivenBy", type: "text", label: "Are you more driven by aesthetics, function, biology, or efficiency?" },
  {
    id: "lastCase",
    type: "text",
    long: true,
    label: "What was the last case that kept you awake at night?",
    helper: "Complication? Failure? Systemic link you couldn't explain?",
  },
  {
    id: "digitalComfort",
    type: "scale",
    label: "How comfortable are you with digital workflows?",
    min: 0,
    max: 10,
    minLabel: "Not at all",
    maxLabel: "Extremely comfortable",
  },
  {
    id: "expectPerko",
    type: "text",
    long: true,
    label: "What do you expect from Dr. Perko as a lecturer?",
    helper: "Protocols? Research depth? Practical shortcuts? Inspiration? Critical debate?",
  },
  {
    id: "practiceSetting",
    type: "text",
    label: "Do you work independently, in a group dental practice, or as part of a broader medical clinic?",
  },
  {
    id: "labDiagnostics",
    type: "text",
    long: true,
    label: "Do you use laboratory diagnostics in your clinical decision-making?",
    helper: "If yes, which ones? If no, what is the main barrier \u2014 knowledge, logistics, cost, or belief?",
  },
  {
    id: "notTellingYet",
    type: "text",
    long: true,
    label: "What are you not telling me yet that I should know about you as a clinician?",
  },
];

export function questionsFor(specialty: "Medical" | "Dental"): Question[] {
  return specialty === "Medical" ? MEDICAL_QUESTIONS : DENTAL_QUESTIONS;
}
