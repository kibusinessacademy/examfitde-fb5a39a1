/**
 * SSOT: Product Module Matrix & Catalog
 * 
 * Defines which modules each product type includes,
 * positioning, USPs, pricing tiers, and tutor modes.
 * 
 * This is the SINGLE SOURCE OF TRUTH for:
 * - Landingpage content generation
 * - Shop feature display
 * - Feature toggle routing
 * - Pipeline module flags
 */

export interface ProductModules {
  examTrainer: boolean;
  examSimulation: boolean;
  miniChecks: boolean;
  aiTutor: boolean;
  oralExam: boolean;
  handbook: boolean;
}

export type CoreFeature = 'exam_simulation' | 'ai_tutor' | 'oral_exam';
export type TutorMode = 'exam_argumentation' | 'ihk_aufstieg' | 'pruefungsdecoder';
export type PricingTier = 'entry' | 'mid' | 'premium' | 'premium_plus';
export type TargetGroup = 'ausbilder' | 'ihk_aufstieg' | 'zertifizierung';

export interface ProductCatalogEntry {
  slug: string;
  title: string;
  shortTitle: string;
  modules: ProductModules;
  coreFeature: CoreFeature;
  positioning: string;
  usps: string[];
  pricingTier: PricingTier;
  priceRangeEur: [number, number];
  targetGroup: TargetGroup;
  tutorMode: TutorMode;
  /** SEO keyword cluster */
  seoKeywords: string[];
  /** CTA text on landing page */
  ctaText: string;
  /** Anchor price for comparison marketing */
  anchorPrice: string;
  /** Whether oral exam is a core differentiator */
  oralIsCoreDifferentiator: boolean;
}

// ═══════════════════════════════════════════════════════════════
// PRODUCT CATALOG — verbindliche Modulmatrix
// ═══════════════════════════════════════════════════════════════

export const PRODUCT_CATALOG: Record<string, ProductCatalogEntry> = {
  // ── FORTBILDUNGEN ──────────────────────────────────────────
  aevo: {
    slug: 'aevo',
    title: 'AEVO Prüfungstraining',
    shortTitle: 'AEVO',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: true,
      handbook: false,
    },
    coreFeature: 'oral_exam',
    positioning: 'Bestehe deine AEVO-Prüfung sicher – inklusive mündlicher Simulation',
    usps: [
      'Einziger echter mündlicher Prüfungstrainer',
      'Praxis + Feedback + Struktur',
      'Didaktische Fehler erkennen',
    ],
    pricingTier: 'mid',
    priceRangeEur: [29, 39],
    targetGroup: 'ausbilder',
    tutorMode: 'exam_argumentation',
    seoKeywords: ['AEVO Prüfung', 'Ausbildereignung', 'AEVO Vorbereitung', 'AEVO mündliche Prüfung'],
    ctaText: 'Prüfungstraining starten',
    anchorPrice: '300–800 €',
    oralIsCoreDifferentiator: true,
  },

  'betriebswirt-ihk': {
    slug: 'betriebswirt-ihk',
    title: 'Betriebswirt IHK Prüfungstraining',
    shortTitle: 'Betriebswirt IHK',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: true,
      handbook: true,
    },
    coreFeature: 'ai_tutor',
    positioning: 'Bestehe deine IHK-Prüfung mit System statt Zufall',
    usps: [
      'KI-gestützte Schwächenanalyse',
      'Transfertraining für echte Prüfungsaufgaben',
      'Echte Prüfungssimulation mit Zeitdruck',
    ],
    pricingTier: 'premium',
    priceRangeEur: [39, 59],
    targetGroup: 'ihk_aufstieg',
    tutorMode: 'ihk_aufstieg',
    seoKeywords: ['Betriebswirt IHK Prüfung', 'Geprüfter Betriebswirt', 'IHK Aufstiegsfortbildung'],
    ctaText: 'Prüfungstraining starten',
    anchorPrice: '1.000–3.000 €',
    oralIsCoreDifferentiator: false,
  },

  'technischer-betriebswirt-ihk': {
    slug: 'technischer-betriebswirt-ihk',
    title: 'Technischer Betriebswirt IHK Prüfungstraining',
    shortTitle: 'Techn. Betriebswirt',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: true,
      handbook: true,
    },
    coreFeature: 'ai_tutor',
    positioning: 'Bestehe deine IHK-Prüfung mit System statt Zufall',
    usps: [
      'KI-gestützte Schwächenanalyse',
      'Transfertraining für echte Prüfungsaufgaben',
      'Echte Prüfungssimulation mit Zeitdruck',
    ],
    pricingTier: 'premium',
    priceRangeEur: [39, 59],
    targetGroup: 'ihk_aufstieg',
    tutorMode: 'ihk_aufstieg',
    seoKeywords: ['Technischer Betriebswirt IHK', 'IHK Prüfung Technischer Betriebswirt'],
    ctaText: 'Prüfungstraining starten',
    anchorPrice: '1.500–4.000 €',
    oralIsCoreDifferentiator: false,
  },

  'wirtschaftsfachwirt-ihk': {
    slug: 'wirtschaftsfachwirt-ihk',
    title: 'Wirtschaftsfachwirt IHK Prüfungstraining',
    shortTitle: 'Wirtschaftsfachwirt',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: true,
      handbook: true,
    },
    coreFeature: 'ai_tutor',
    positioning: 'Bestehe deine IHK-Prüfung mit System statt Zufall',
    usps: [
      'KI-gestützte Schwächenanalyse',
      'Transfertraining für echte Prüfungsaufgaben',
      'Echte Prüfungssimulation mit Zeitdruck',
    ],
    pricingTier: 'premium',
    priceRangeEur: [39, 59],
    targetGroup: 'ihk_aufstieg',
    tutorMode: 'ihk_aufstieg',
    seoKeywords: ['Wirtschaftsfachwirt IHK Prüfung', 'Geprüfter Wirtschaftsfachwirt'],
    ctaText: 'Prüfungstraining starten',
    anchorPrice: '800–2.500 €',
    oralIsCoreDifferentiator: false,
  },

  'industriemeister-metall-ihk': {
    slug: 'industriemeister-metall-ihk',
    title: 'Industriemeister Metall IHK Prüfungstraining',
    shortTitle: 'Industriemeister Metall',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: true,
      handbook: true,
    },
    coreFeature: 'ai_tutor',
    positioning: 'Bestehe deine IHK-Prüfung mit System statt Zufall',
    usps: [
      'KI-gestützte Schwächenanalyse',
      'Transfertraining für echte Prüfungsaufgaben',
      'Echte Prüfungssimulation mit Zeitdruck',
    ],
    pricingTier: 'premium',
    priceRangeEur: [39, 59],
    targetGroup: 'ihk_aufstieg',
    tutorMode: 'ihk_aufstieg',
    seoKeywords: ['Industriemeister Metall IHK', 'IHK Industriemeister Prüfung'],
    ctaText: 'Prüfungstraining starten',
    anchorPrice: '2.000–5.000 €',
    oralIsCoreDifferentiator: false,
  },

  'bilanzbuchhalter-ihk': {
    slug: 'bilanzbuchhalter-ihk',
    title: 'Bilanzbuchhalter IHK Prüfungstraining',
    shortTitle: 'Bilanzbuchhalter',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: false,
      handbook: true,
    },
    coreFeature: 'ai_tutor',
    positioning: 'Bestehe komplexe Rechnungen sicher – ohne Rechenfehler',
    usps: [
      'Calculation-Traps erkennen',
      'KI-Fehleranalyse für Buchungssätze',
      'Rechenlogik verstehen statt auswendig lernen',
    ],
    pricingTier: 'premium_plus',
    priceRangeEur: [49, 69],
    targetGroup: 'ihk_aufstieg',
    tutorMode: 'ihk_aufstieg',
    seoKeywords: ['Bilanzbuchhalter IHK Prüfung', 'Geprüfter Bilanzbuchhalter'],
    ctaText: 'Prüfungstraining starten',
    anchorPrice: '2.000–6.000 €',
    oralIsCoreDifferentiator: false,
  },

  // ── ZERTIFIZIERUNGEN ──────────────────────────────────────
  'scrum-master-psm1': {
    slug: 'psm-1-scrum',
    title: 'Scrum Master PSM I Prüfungstraining',
    shortTitle: 'Scrum Master',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: false,
      handbook: false,
    },
    coreFeature: 'exam_simulation',
    positioning: 'Verstehe Scrum wirklich – und bestehe die Prüfung sicher',
    usps: [
      'Verständnis statt Auswendiglernen',
      'Typische Fehlinterpretationen erkennen',
      'Prüfungslogik durchschauen',
    ],
    pricingTier: 'entry',
    priceRangeEur: [19, 29],
    targetGroup: 'zertifizierung',
    tutorMode: 'pruefungsdecoder',
    seoKeywords: ['Scrum Master Prüfung', 'PSM I Vorbereitung', 'Scrum Zertifizierung'],
    ctaText: 'Zertifizierung vorbereiten',
    anchorPrice: '800–1.500 €',
    oralIsCoreDifferentiator: false,
  },

  'prince2-foundation': {
    slug: 'prince2-foundation',
    title: 'PRINCE2 Foundation Prüfungstraining',
    shortTitle: 'PRINCE2',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: false,
      handbook: false,
    },
    coreFeature: 'exam_simulation',
    positioning: 'Bestehe PRINCE2 – ohne unnötige Theorie',
    usps: [
      'Framework-Verständnis statt Fakten pauken',
      'Prüfungslogik verstehen',
      'Klare Abgrenzungen trainieren',
    ],
    pricingTier: 'entry',
    priceRangeEur: [19, 29],
    targetGroup: 'zertifizierung',
    tutorMode: 'pruefungsdecoder',
    seoKeywords: ['PRINCE2 Foundation Prüfung', 'PRINCE2 Zertifizierung'],
    ctaText: 'Zertifizierung vorbereiten',
    anchorPrice: '800–1.200 €',
    oralIsCoreDifferentiator: false,
  },

  'aws-cloud-practitioner': {
    slug: 'aws-cloud-practitioner',
    title: 'AWS Cloud Practitioner Prüfungstraining',
    shortTitle: 'AWS CLF-C02',
    modules: {
      examTrainer: true,
      examSimulation: true,
      miniChecks: true,
      aiTutor: true,
      oralExam: false,
      handbook: false,
    },
    coreFeature: 'exam_simulation',
    positioning: 'Bestehe deine AWS-Zertifizierung im ersten Versuch',
    usps: [
      'Echte Prüfungslogik trainieren',
      'Trickfragen verstehen',
      'Kein Overlearning – fokussiert auf Pass-Rate',
    ],
    pricingTier: 'entry',
    priceRangeEur: [19, 29],
    targetGroup: 'zertifizierung',
    tutorMode: 'pruefungsdecoder',
    seoKeywords: ['AWS Cloud Practitioner Prüfung', 'AWS Zertifizierung', 'CLF-C02'],
    ctaText: 'Zertifizierung vorbereiten',
    anchorPrice: '300–600 €',
    oralIsCoreDifferentiator: false,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

export function getProductBySlug(slug: string): ProductCatalogEntry | undefined {
  return Object.values(PRODUCT_CATALOG).find(p => p.slug === slug);
}

export function getActiveModuleLabels(modules: ProductModules): string[] {
  const labels: string[] = [];
  if (modules.examTrainer) labels.push('Prüfungstrainer');
  if (modules.examSimulation) labels.push('Prüfungssimulation');
  if (modules.miniChecks) labels.push('MiniChecks');
  if (modules.aiTutor) labels.push('KI-Tutor');
  if (modules.oralExam) labels.push('Mündliche Prüfung');
  if (modules.handbook) labels.push('Handbuch');
  return labels;
}

export function getPricingDisplay(entry: ProductCatalogEntry): string {
  const [min, max] = entry.priceRangeEur;
  if (min === max) return `${min},00 €`;
  return `ab ${min},00 €`;
}

/** Group catalog by target group for landing page sections */
export function getCatalogByTargetGroup() {
  const groups: Record<TargetGroup, ProductCatalogEntry[]> = {
    ausbilder: [],
    ihk_aufstieg: [],
    zertifizierung: [],
  };
  for (const entry of Object.values(PRODUCT_CATALOG)) {
    groups[entry.targetGroup].push(entry);
  }
  return groups;
}
