import "dotenv/config";
import bcrypt from "bcryptjs";
import { storage, db } from "./storage";
import {
  users, sessions, products, priceTiers, orders, orderItems, referrals,
  videos, courses, courseAccessGrants, coursePurchases, modules, cohorts, cohortEnrollments,
  classSessions, homeworkSubmissions, chatThreads, chatMessages,
  pushSubscriptions, announcements, uploadedFiles,
} from "@shared/schema";

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  console.log("Clearing existing data...");
  db.delete(announcements).run();
  db.delete(pushSubscriptions).run();
  db.delete(uploadedFiles).run();
  db.delete(chatMessages).run();
  db.delete(chatThreads).run();
  db.delete(homeworkSubmissions).run();
  db.delete(classSessions).run();
  db.delete(cohortEnrollments).run();
  db.delete(cohorts).run();
  db.delete(modules).run();
  db.delete(coursePurchases).run();
  db.delete(courseAccessGrants).run();
  db.delete(videos).run();
  db.delete(courses).run();
  db.delete(orderItems).run();
  db.delete(orders).run();
  db.delete(referrals).run();
  db.delete(priceTiers).run();
  db.delete(products).run();
  db.delete(sessions).run();
  db.delete(users).run();

  console.log("Seeding admin: Elisabeth Madden...");
  // Real production admin credential — must never be hardcoded in source.
  // Set ADMIN_SEED_PASSWORD in the environment before running this script.
  const adminPasswordPlain = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPasswordPlain) {
    throw new Error(
      "ADMIN_SEED_PASSWORD env var is required to seed the admin account (no hardcoded default for security)."
    );
  }
  const adminHash = await bcrypt.hash(adminPasswordPlain, 10);
  const admin = await storage.createUser({
    role: "admin",
    name: "Elisabeth Madden",
    email: "elisabeth.madden.medical@gmail.com",
    passwordHash: adminHash,
    status: "approved",
    phone: "+386 51 248 888",
    businessName: null,
    vatNumber: null,
    profession: null,
    homepageUrl: null,
    degreeFileUrl: null,
  } as any);
  console.log("Admin created:", admin.email, "password:", adminPasswordPlain);

  console.log("Seeding admin: Tina...");
  // Real production admin credential — must never be hardcoded in source.
  // Set TINA_SEED_PASSWORD in the environment before running this script.
  const tinaPasswordPlain = process.env.TINA_SEED_PASSWORD;
  if (!tinaPasswordPlain) {
    throw new Error(
      "TINA_SEED_PASSWORD env var is required to seed this admin account (no hardcoded default for security)."
    );
  }
  const tinaHash = await bcrypt.hash(tinaPasswordPlain, 10);
  const tina = await storage.createUser({
    role: "admin",
    name: "Tina",
    email: "tina@maha.si",
    passwordHash: tinaHash,
    status: "approved",
    phone: null,
    businessName: null,
    vatNumber: null,
    profession: null,
    homepageUrl: null,
    degreeFileUrl: null,
  } as any);
  console.log("Admin created:", tina.email, "password:", tinaPasswordPlain);

  console.log("Seeding demo partner...");
  const partnerPasswordPlain = "PartnerDemo2026!";
  const partnerHash = await bcrypt.hash(partnerPasswordPlain, 10);
  const partner = await storage.createUser({
    role: "partner",
    name: "Dr. Sara Novak",
    email: "partner.demo@maha.clinic",
    passwordHash: partnerHash,
    status: "approved",
    phone: "+386 40 123 456",
    businessName: "Novak Dental Wellness Clinic",
    vatNumber: "SI12345678",
    profession: null,
    homepageUrl: "https://novakdental.example.com",
    degreeFileUrl: null,
  } as any);
  console.log("Partner created:", partner.email, "password:", partnerPasswordPlain);

  console.log("Seeding demo student...");
  const studentPasswordPlain = "StudentDemo2026!";
  const studentHash = await bcrypt.hash(studentPasswordPlain, 10);
  const student = await storage.createUser({
    role: "student",
    name: "Dr. Miha Kovač",
    email: "student.demo@maha.clinic",
    passwordHash: studentHash,
    status: "approved",
    phone: "+386 41 987 654",
    businessName: null,
    vatNumber: null,
    profession: "General Dentist",
    homepageUrl: "https://kovacdental.example.com",
    degreeFileUrl: null,
  } as any);
  console.log("Student created:", student.email, "password:", studentPasswordPlain);

  // A second pending partner + pending student, for testing Pending Approvals
  await storage.createUser({
    role: "partner",
    name: "Dr. Lena Hofer",
    email: "lena.hofer.pending@example.com",
    passwordHash: await bcrypt.hash("Temp12345!", 10),
    status: "pending",
    phone: "+43 660 111 2233",
    businessName: "Hofer Integrative Health",
    vatNumber: "ATU99887766",
    profession: null,
    homepageUrl: "https://hofer-health.example.com",
    degreeFileUrl: "/api/uploads/sample-license.pdf",
  } as any);
  await storage.createUser({
    role: "student",
    name: "Ana Petrović",
    email: "ana.petrovic.pending@example.com",
    passwordHash: await bcrypt.hash("Temp12345!", 10),
    status: "pending",
    phone: "+385 91 222 3344",
    businessName: null,
    vatNumber: null,
    profession: "Dental Hygienist",
    homepageUrl: "",
    degreeFileUrl: "/api/uploads/sample-diploma.pdf",
  } as any);

  console.log("Seeding products...");
  // weightGrams values below are approximate net weights (grams) used only for the
  // checkout shipping estimator — not verified carrier specs.
  // Pricing, descriptions, and package sizes below are the client's freshly
  // re-verified live-shop data (EUR, excl. VAT). Base price applies below the
  // first tier's minimum quantity; each product carries its own tier table.
  // weightGrams are unchanged (shipping estimator only). packageSize is null
  // where the live shop genuinely did not specify one.
  const productDefs = [
    {
      name: "MAHA Essentials Starter Pack",
      description: "12x Omni EM Ferment; 12x Detox Arcanum; 6x Entralisol; 3x Immunonovum; 3x MAHA40; 60min guided use consultation for 1 patient case. Discounted onboarding bundle (from €2,696.16).",
      packageSize: "Bundle (contents as listed)",
      unitPrice: 200000,
      weightGrams: 2500,
      tiers: [] as { minQty: number; maxQty: number | null; pricePerUnit: number }[],
    },
    {
      name: "OMNI EM Ferment",
      description: "Omni em ferment is a premium fermented drink containing 31 strains of beneficial bacteria with probiotic properties, as well as pre- and postbiotics from 31 plant sources. It is the best choice for supporting the diversity of the gut microbiome and gut health.",
      packageSize: "Use: 20ml/day",
      unitPrice: 3927,
      weightGrams: 500,
      tiers: [
        { minQty: 5, maxQty: 24, pricePerUnit: 3142 },
        { minQty: 25, maxQty: 99, pricePerUnit: 3063 },
        { minQty: 100, maxQty: 549, pricePerUnit: 2945 },
        { minQty: 550, maxQty: null, pricePerUnit: 2749 },
      ],
    },
    {
      name: "Entralisol",
      description: "Entralisol is an innovative dietary supplement with a complex of 14 carefully selected bioavailable polyphenols and bioactive vitamins that work synergistically to support the regeneration of the mucous membranes of the digestive tract and are distinguished by excellent antioxidant activity.",
      packageSize: "Use: 1–5ml diluted in 200ml water",
      unitPrice: 10959,
      weightGrams: 400,
      tiers: [
        { minQty: 5, maxQty: 24, pricePerUnit: 8767 },
        { minQty: 25, maxQty: 99, pricePerUnit: 8548 },
        { minQty: 100, maxQty: 549, pricePerUnit: 8219 },
        { minQty: 550, maxQty: null, pricePerUnit: 7671 },
      ],
    },
    {
      name: "Detoxarcanum",
      description: "A highly concentrated complex of natural ingredients for effective support of cellular cleansing and safe detoxification in all stages. Contains glutathione, chlorophyllin, coriander, Sicilian lemon, and pine to support detoxification and autophagy.",
      packageSize: "Use: 5–10ml/day in 300ml water",
      unitPrice: 5479,
      weightGrams: 300,
      tiers: [
        { minQty: 5, maxQty: 24, pricePerUnit: 4384 },
        { minQty: 25, maxQty: 99, pricePerUnit: 4274 },
        { minQty: 100, maxQty: 999, pricePerUnit: 4110 },
        { minQty: 1000, maxQty: null, pricePerUnit: 3836 },
      ],
    },
    {
      name: "Imunonovum",
      description: "Imunonovum is a natural polypeptide lactic ferment with biomodulatory action to restore balance in the functioning of the immune system. Supports immune balance, inflammation reduction, and cardiovascular/neurological health.",
      packageSize: null,
      unitPrice: 35616,
      weightGrams: 300,
      tiers: [
        { minQty: 5, maxQty: 149, pricePerUnit: 32055 },
        { minQty: 150, maxQty: null, pricePerUnit: 30274 },
      ],
    },
    {
      name: "Liposomal Kurkumin & Resveratrol",
      description: "Liposomal curcumin and resveratrol are powerful antioxidants that are highly valued in Ayurvedic science for their numerous health benefits. Resveratrol from red grape skin/Japanese knotweed root; curcumin from turmeric.",
      packageSize: null,
      unitPrice: 6849,
      weightGrams: 250,
      tiers: [
        { minQty: 10, maxQty: 199, pricePerUnit: 6164 },
        { minQty: 200, maxQty: 999, pricePerUnit: 5137 },
        { minQty: 1000, maxQty: null, pricePerUnit: 4109 },
      ],
    },
    {
      name: "MAHA 40",
      description: "40 minerals and vitamins, everything the body needs. Addresses vital-substance deficiencies, inflammation, and toxin load with a full vitamin/mineral spectrum.",
      packageSize: null,
      unitPrice: 5388,
      weightGrams: 150,
      tiers: [
        { minQty: 5, maxQty: 24, pricePerUnit: 4849 },
        { minQty: 25, maxQty: 99, pricePerUnit: 4310 },
        { minQty: 100, maxQty: 549, pricePerUnit: 3933 },
        { minQty: 550, maxQty: null, pricePerUnit: 3502 },
      ],
    },
    {
      name: "MAHA Mineral Care",
      description: "MAHA Mineralcare – a fluoride-free formulation that simultaneously remineralizes hard dental tissues, soothes gums, relieves hypersensitivity, and delivers long-lasting, gentle citrus-herbal freshness. Uses bioactive glass and phytocannabinoids.",
      packageSize: "75ml tube",
      unitPrice: 1361,
      weightGrams: 200,
      tiers: [
        { minQty: 50, maxQty: 99, pricePerUnit: 1089 },
        { minQty: 100, maxQty: null, pricePerUnit: 1021 },
      ],
    },
    {
      name: "Clarified Ghee",
      description: "Cooked Ghee butter (100%) from organic cow's milk. Made by low-temperature cooking of high-quality organically produced cow's milk.",
      packageSize: null,
      unitPrice: 1130,
      weightGrams: 400,
      tiers: [
        { minQty: 10, maxQty: 49, pricePerUnit: 929 },
        { minQty: 50, maxQty: null, pricePerUnit: 877 },
      ],
    },
    {
      name: "Shatavari Ghee",
      description: "Nourish your body and soul with our Shatavari Ghee. Handmade using traditional Ayurvedic methods; for internal use only, not suitable for cooking.",
      packageSize: null,
      unitPrice: 2183,
      weightGrams: 400,
      tiers: [
        { minQty: 10, maxQty: 49, pricePerUnit: 1965 },
        { minQty: 50, maxQty: null, pricePerUnit: 1856 },
      ],
    },
    {
      name: "Triphala Ghee",
      description: "Discover the perfect blend of ancient Ayurvedic wisdom and modern wellness with our Triphala Ghee. Made with traditional methods, no additives/preservatives; take alone or mixed in warm water/milk.",
      packageSize: null,
      unitPrice: 2082,
      weightGrams: 400,
      tiers: [
        { minQty: 10, maxQty: 49, pricePerUnit: 1874 },
        { minQty: 50, maxQty: null, pricePerUnit: 1770 },
      ],
    },
    {
      name: "Brahmi Ghee",
      description: "Experience the soothing and rejuvenating power of Ayurveda with Brahmi Ghee. Crafted using traditional Ayurvedic techniques; for internal use only, not for cooking.",
      packageSize: null,
      unitPrice: 2082,
      weightGrams: 400,
      tiers: [
        { minQty: 10, maxQty: 49, pricePerUnit: 1874 },
        { minQty: 50, maxQty: null, pricePerUnit: 1770 },
      ],
    },
  ];

  for (const p of productDefs) {
    const product = await storage.createProduct({
      name: p.name,
      description: p.description,
      packageSize: p.packageSize,
      imageUrl: null,
      unitPrice: p.unitPrice,
      active: true,
      weightGrams: p.weightGrams,
    } as any);
    for (const t of p.tiers) {
      await storage.createTier({ productId: product.id, minQty: t.minQty, maxQty: t.maxQty, pricePerUnit: t.pricePerUnit });
    }
  }
  console.log(`Seeded ${productDefs.length} products.`);

  console.log("Seeding courses and lessons...");
  // Real MAHA education structure (verbatim titles from the live partner platform).
  // Lesson URLs are intentionally empty placeholders — the real video links are not
  // yet available and must NOT be fabricated; an admin fills them in later.
  const courseDefs: {
    name: string;
    description: string | null;
    priceCents: number | null;
    accessType: "open" | "enroll" | "paid";
    lessons: string[];
  }[] = [
    {
      name: "Free lessons",
      description:
        "Explore MAHA Clinic's integrative health resources through free lessons and educational content. Learn about holistic wellness, dental care, herbal therapies, and the body's interconnected systems, empowering you to take charge of your health.",
      priceCents: null,
      accessType: "open",
      lessons: [
        "F-01 – Biological dentistry fundamentals and effective methods",
        "F-02 – Biological dentistry: the microbiome and osteoimmunology as key factors for systemic health",
        "F-03 – 7th International Congress of Integrative Medicine – Portugal",
        "F-04 – Constitution of man in 15min",
        "F-05 – Financial intelligence in integrative medicine",
        "F-07 – Reconnecting Medicine & Dentistry Dubai 2026",
      ],
    },
    {
      name: "Maha Symposium public lectures",
      description: null,
      priceCents: null,
      accessType: "enroll",
      lessons: [
        "SP-2026 – dr. Sebastjano Perko",
        "SP-2026 – dr. Ana Moreira",
      ],
    },
    {
      name: "Maha Symposium lectures",
      description: null,
      priceCents: 25000,
      accessType: "paid",
      lessons: [
        "S1 – 2026 – DDr. Johann Lechner PhD-UCN",
        "S2 – 2026 – Dr. Sebastjan Perko PhD.",
        "S3 – 2026 – Prof. Dr. Nataša Kejžar",
        "S4 – 2026 – Dr. Gregor Hočevar M.Sc.",
        "S5 – 2026 – Dr. med. dent. John Augspurger, NMD, IBDM",
        "S6 – 2026 – Prof. Dr. Curd Bollen, DDS",
        "S7 – 2026 – Dr. Marcus Stanton",
        "S8 – 2026 – Dominik Golenhofen, univ.dipl.ing.grad. dipl.hol.ener.med.",
        "S9 – 2026 – Dr. rer. nat. Heiko Hofmann",
        "S10 – 2026 – Dr. Ana Moreira",
        "S11 – 2026 – Dr. med. Kurt E. Müller",
        "S12 – 2026 – Dr. Ralf Oettmeier",
        "S13 – 2026 – Dr. Vaidya Ajil Kunhumbidukka Veettil",
        "S14 – 2026 – Dr. med. Antonina Rome",
        "S15 – 2026 – Allyson Ann Orme BA, MA, HHP",
        "S16 – 2026 – DDr. Matjaž L. Regovec",
        "S17 – 2026 – Petra Brzović",
        "S18 – 2026 – Zenel Batagelj",
        "S19 – 2026 – Panel Discussion – The Future of Integrative Medicine",
      ],
    },
  ];

  // Real, publicly-hosted video files confirmed live on partner.maha.clinic for the
  // "Free lessons" course (open access, no purchase gate). Other courses' lesson URLs
  // remain empty placeholders since they require enrollment/purchase upstream to view.
  const freeLessonUrls: Record<string, string> = {
    "F-01 – Biological dentistry fundamentals and effective methods":
      "https://partner.maha.clinic/wp-content/uploads/2025/09/biological_dentistry__fundamentals_and_effective_methods_-_dr._med._dent._sebastjan_perko_phd.-1080p_1.mp4",
    "F-02 – Biological dentistry: the microbiome and osteoimmunology as key factors for systemic health":
      "https://partner.maha.clinic/wp-content/uploads/2025/09/biological_dentistry_-_the_microbiome_and_osteoimmunology_as_key_factors_for_systemic_health-1080p_01.mp4",
    "F-03 – 7th International Congress of Integrative Medicine – Portugal":
      "https://partner.maha.clinic/wp-content/uploads/2025/12/7th-International-Congress-of-Integrative-Medicine-_-Portugal-_-B1-Room-_-Day-1.mp4",
    "F-04 – Constitution of man in 15min":
      "https://partner.maha.clinic/wp-content/uploads/2026/01/Constitution-of-man-in-15min-incl.-subtitles.mp4",
    "F-05 – Financial intelligence in integrative medicine":
      "https://partner.maha.clinic/wp-content/uploads/2026/01/financal-inteligence.mp4",
    "F-07 – Reconnecting Medicine & Dentistry Dubai 2026":
      "https://partner.maha.clinic/wp-content/uploads/2026/02/Reconnecting-Medicine-Dentistry-Dubai-2026_1.mp4",
  };

  let lessonCount = 0;
  for (const c of courseDefs) {
    const course = await storage.createCourse({
      name: c.name,
      description: c.description,
      priceCents: c.priceCents,
      currency: "eur",
      accessType: c.accessType,
    });
    for (const title of c.lessons) {
      await storage.createVideo({
        title,
        description: null,
        url: freeLessonUrls[title] ?? "",
        category: course.name,
        courseId: course.id,
        isPremium: c.accessType === "paid",
        thumbnailUrl: null,
      });
      lessonCount++;
    }
  }
  console.log(`Seeded ${courseDefs.length} courses with ${lessonCount} lessons.`);

  console.log("Seeding Institute modules, cohorts, and class sessions...");
  const now = new Date("2026-08-10T08:00:00Z").getTime();

  const moduleDefs = [
    {
      name: "Perio",
      description: "Periodontal disease through an integrative lens — infectious and aseptic inflammation, oral microbiome, and biological treatment protocols.",
      sessions: [
        { title: "Day 1: Understanding Inflammation — Periodontal Disease & Endodontics", offsetDays: 0, notes: "Infectious inflammation overview; transitioning roles from dentist to doctor." },
        { title: "Day 2: Osteoimmunology — Bridging Bone Health & Immunity", offsetDays: 7, notes: "Aseptic inflammation, comprehensive medical diagnostics in dentistry." },
        { title: "Day 3: Innovative Materials Across Dental Specialties", offsetDays: 14, notes: "Bioceramic materials, resin composites, and implant osseointegration." },
        { title: "Day 4: Safe Removal of Metals from the Oral Cavity", offsetDays: 21, notes: "Principles of metal removal and biocompatibility." },
      ],
    },
    {
      name: "Endo",
      description: "Endodontic case management integrated with systemic health markers, dark-field diagnostics, and detox-informed protocols.",
      sessions: [
        { title: "Day 1: Case-Specific Approaches — Lab Work, Infusions & Non-Invasive Therapies", offsetDays: 0, notes: "Decision-making algorithms and dark field microscopy applications." },
        { title: "Day 2: Detox & Rebuilding Strategies in Dental Therapies", offsetDays: 7, notes: "Core principles of detoxification tied to endodontic treatment planning." },
        { title: "Day 3: Live Therapy Demonstrations", offsetDays: 14, notes: "Hands-on paired participant presentation of therapy plans using diagnostic data." },
        { title: "Day 4: Comprehensive Treatment Planning with Real Patient Cases", offsetDays: 21, notes: "Live patient visit and communication strategies." },
      ],
    },
    {
      name: "Function",
      description: "Functional and biomechanical dentistry — occlusion, TMJ, parafunction, and structural diagnostics.",
      sessions: [
        { title: "Day 1: Functional & Structural Anatomy and Diagnostics", offsetDays: 0, notes: "Holistic anatomy of the oral cavity and basic diagnostic methods." },
        { title: "Day 2: Trigemino-Cervical Trunk & Dental Functionality", offsetDays: 7, notes: "Deep dive into functional and structural dentistry." },
        { title: "Day 3: Understanding Parafunctions — Physiology & Psychology", offsetDays: 14, notes: "Physiological and psychological dimensions of parafunction." },
        { title: "Day 4: Advanced Occlusion Techniques & Splint Therapy", offsetDays: 21, notes: "Practical techniques in occlusal adjustment." },
      ],
    },
    {
      name: "Esthetics",
      description: "Biocompatible esthetic dentistry — smile design, metal-free restorations, and aesthetic treatment planning.",
      sessions: [
        { title: "Day 1: Nutrition & Holistic Interventions in Dentistry", offsetDays: 0, notes: "Nutrition's role in oral health and herbal/homeopathic remedies." },
        { title: "Day 2: Biomechanics & Aesthetics — Metal-Free Restorations", offsetDays: 7, notes: "BioHPP, zirconium ceramics, and aesthetic principles." },
        { title: "Day 3: Functional & Aesthetic Applications", offsetDays: 14, notes: "Facial and dental photography for smile design." },
        { title: "Day 4: Restorative Materials in Integrative Dentistry", offsetDays: 21, notes: "Guest lecture on bioceramics, composites, and adhesives." },
      ],
    },
    {
      name: "Non-Dental — Dentistry Through a Doctor's Eyes",
      description: "A 5-day track for non-dental physicians to understand integrative dentistry's role in systemic health, designed around real X-ray case review.",
      sessions: [
        { title: "Day 1: Overview — Transitioning Roles from Doctor to Dentist", offsetDays: 0, notes: "Infectious inflammation: periodontal disease and endodontics." },
        { title: "Day 2: Principles of Reading Dental X-Rays", offsetDays: 7, notes: "2D and 3D radiographs, dental nomenclature and anatomy for imaging." },
        { title: "Day 3: Common Dental Pathologies", offsetDays: 14, notes: "Caries, periapical pathology, restorations and endodontic treatments on radiographs." },
        { title: "Day 4: Practical Insights in Dental Therapies", offsetDays: 21, notes: "Extractions and case studies; innovative materials and methods." },
        { title: "Day 5: Real Patient Case Analysis (Live)", offsetDays: 28, notes: "Bring five 2D panoramic X-rays and five 3D CBCT scans, preferably from the same patient." },
      ],
    },
  ];

  const studentEnrollCohortIds: number[] = [];

  for (const m of moduleDefs) {
    const mod = await storage.createModule({ name: m.name, description: m.description });
    const cohort = await storage.createCohort({ moduleId: mod.id, name: `${m.name} — Autumn 2026 Cohort` });
    studentEnrollCohortIds.push(cohort.id);
    for (const s of m.sessions) {
      await storage.createClassSession({
        cohortId: cohort.id,
        title: s.title,
        datetime: now + s.offsetDays * DAY,
        zoomLink: "https://zoom.us/j/0000000000",
        notes: s.notes,
      });
    }
  }
  console.log(`Seeded ${moduleDefs.length} modules with cohorts and sessions.`);

  console.log("Enrolling demo student in Perio and Function cohorts...");
  await storage.createEnrollment({ cohortId: studentEnrollCohortIds[0], studentId: student.id });
  await storage.createEnrollment({ cohortId: studentEnrollCohortIds[2], studentId: student.id });

  console.log("Seeding a sample past class + homework submission...");
  const perioCohortId = studentEnrollCohortIds[0];
  const pastSession = await storage.createClassSession({
    cohortId: perioCohortId,
    title: "Orientation: Course Overview & Foundations",
    datetime: new Date("2026-07-15T08:00:00Z").getTime(),
    zoomLink: "https://zoom.us/j/0000000000",
    notes: "Introductory session — recording available on request.",
  });
  await storage.createHomework({
    classSessionId: pastSession.id,
    studentId: student.id,
    fileUrl: "/api/uploads/sample-homework.pdf",
    fileType: "application/pdf",
    comment: "Case write-up as discussed in orientation.",
    createdAt: Date.now() - 3 * DAY,
  });

  console.log("Seeding sample referral, order, and chat messages for the demo partner...");
  await storage.createReferral({
    partnerId: partner.id,
    patientFirstName: "Janez",
    patientLastName: "Kranjc",
    patientContact: "janez.kranjc@example.com / +386 31 555 222",
    caseDescription: "Chronic periodontal inflammation with suspected systemic burden; patient requesting biological treatment options.",
    urgency: "Normal",
    notes: "Patient prefers morning appointments.",
    createdAt: Date.now() - 2 * DAY,
  } as any);

  const order = await storage.createOrder({ partnerId: partner.id, createdAt: Date.now() - DAY } as any);
  const mahaProducts = await storage.listProducts();
  const maha40 = mahaProducts.find((p) => p.name === "MAHA 40")!;
  const detox = mahaProducts.find((p) => p.name === "Detoxarcanum")!;
  await storage.createOrderItem({ orderId: order.id, productId: maha40.id, quantity: 10, unitPriceAtOrder: Math.round(5388 * 0.9) });
  await storage.createOrderItem({ orderId: order.id, productId: detox.id, quantity: 15, unitPriceAtOrder: 4930 });

  const thread = await storage.createThread(partner.id, "partner", "Order follow-up");
  await storage.createMessage({
    threadId: thread.id,
    senderId: partner.id,
    senderRole: "partner",
    senderName: partner.name,
    body: "Hi team, following up on my last order — any update on the shipping timeline?",
    createdAt: Date.now() - 5 * 60 * 60 * 1000,
  });
  await storage.createMessage({
    threadId: thread.id,
    senderId: admin.id,
    senderRole: "admin",
    senderName: admin.name,
    body: "Hi Dr. Novak, thanks for reaching out — your order is confirmed and should ship within 2 business days!",
    createdAt: Date.now() - 3 * 60 * 60 * 1000,
  });

  // Example upcoming case discussion so the partner home + admin table are populated on a fresh seed.
  await storage.createCaseDiscussion({
    topic: "Complex perio-restorative case: staging & sequencing",
    presenterName: "Dr. Sara Novak",
    scheduledAt: Date.now() + 5 * DAY,
    zoomLink: "https://zoom.us/j/91234567890",
    notes: "Bring an anonymized case of your own to discuss. We'll review treatment sequencing and material selection.",
  });

  console.log("\n=== SEED COMPLETE ===");
  console.log("Admin login: elisabeth.madden.medical@gmail.com /", adminPasswordPlain);
  console.log("Admin login (Tina): tina@maha.si /", tinaPasswordPlain);
  console.log("Demo partner login: partner.demo@maha.clinic /", partnerPasswordPlain);
  console.log("Demo student login: student.demo@maha.clinic /", studentPasswordPlain);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
