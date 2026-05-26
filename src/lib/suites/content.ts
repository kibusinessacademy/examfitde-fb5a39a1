/**
 * Marketing-SSOT für die 4 Berufs-KI Suiten.
 *
 * Code-side Content-Layer — keine neue DB-Tabelle.
 * Slugs müssen mit berufs_ki_product_suites.slug übereinstimmen.
 *
 * Plan: Berufs-KI Market Activation v1 — Cut 1 (Packaging & Positionierung).
 */
export type SuiteSlug =
  | "ausbildungsleiter"
  | "pruefungsreife"
  | "risk_recovery"
  | "standort_intelligence";

export interface SuiteValueProp {
  title: string;
  body: string;
}

export interface SuiteROIMetric {
  label: string;
  value: string;
  hint: string;
}

export interface SuiteFeature {
  title: string;
  body: string;
}

export interface SuitePricingTier {
  name: string;
  audience: string;
  priceHint: string;
  includes: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
}

export interface SuiteContent {
  slug: SuiteSlug;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: { label: string; href: string };
    secondaryCta?: { label: string; href: string };
  };
  outcomes: SuiteValueProp[];
  features: SuiteFeature[];
  roi: SuiteROIMetric[];
  pricing: SuitePricingTier[];
  proofPoints: string[];
  faqs: { q: string; a: string }[];
}

/** Identische CTAs für alle Suites — Sales-Kontakt + Self-Service-Demo. */
const CTA_DEMO = { label: "Live-Demo ansehen", href: "/enterprise-demo" } as const;
const CTA_SALES = { label: "Beratung anfragen", href: "/kontakt" } as const;

export const SUITE_CONTENT: Record<SuiteSlug, SuiteContent> = {
  ausbildungsleiter: {
    slug: "ausbildungsleiter",
    hero: {
      eyebrow: "Ausbildungsleiter Suite",
      title: "Eine Oberfläche für jeden Ausbildungstag",
      subtitle:
        "Tagesbriefing, Risiko-Radar und wirksame Interventionen — automatisiert, priorisiert, nachvollziehbar.",
      primaryCta: { label: "Suite testen", href: "/berufs-ki/copilot" },
      secondaryCta: CTA_DEMO,
    },
    outcomes: [
      {
        title: "Tagesstart in 3 Minuten",
        body: "Manager-Copilot fasst Risiken, Fortschritte und Empfehlungen für den Tag in einem Briefing.",
      },
      {
        title: "Keine versteckten Probleme",
        body: "Risk Radar zeigt gefährdete Azubis bevor sie aus dem Lernrhythmus fallen.",
      },
      {
        title: "Wirksame Eingriffe",
        body: "Vorgefertigte Interventionen mit klarem Auslöser, Empfänger und Wirkungsnachweis.",
      },
    ],
    features: [
      { title: "Manager-Copilot", body: "Tagesbriefing aus Risk Radar, Cohort-Trends und Graph-Risiken." },
      { title: "Cohort Intelligence", body: "Vergleich, Stagnation, Best-Practice pro Lerngruppe." },
      { title: "Intervention-Workflows", body: "Deterministische Regeln + manueller Override mit Audit." },
      { title: "Executive Narrative", body: "Auf-einen-Blick-Story für die nächste Standortleitung." },
    ],
    roi: [
      { label: "Aufwand Tagesführung", value: "−65%", hint: "vs. manuelles Reporting in Excel/IHK-Tools" },
      { label: "Frühindikatoren-Trefferquote", value: "≥80%", hint: "Risk Radar 14 Tage vor Eskalation" },
      { label: "Time-to-Intervention", value: "<24h", hint: "vom Signal bis zur Aktion" },
    ],
    pricing: [
      {
        name: "Team",
        audience: "1 Standort, bis 25 Azubis",
        priceHint: "ab 199 €/Monat",
        includes: ["Manager-Copilot", "Risk Radar", "Cohort-Vergleich", "Standard-Interventionen"],
        cta: { label: "Suite starten", href: "/berufs-ki/copilot" },
      },
      {
        name: "Enterprise",
        audience: "Multi-Standort, Multi-Cohort",
        priceHint: "individuell",
        includes: ["Alle Team-Features", "Custom-Interventionen", "Multi-Standort-Rollout", "SSO + SCIM"],
        cta: CTA_SALES,
        highlight: true,
      },
    ],
    proofPoints: [
      "Tagesbriefing aus 6 Datenquellen (Risk · Cohort · Graph · Outcome · Recovery · Curriculum).",
      "Audit-Trail über jede Intervention — DSGVO- und IHK-Audit-fest.",
      "Integration in bestehende Ausbildungsnachweise via Export.",
    ],
    faqs: [
      {
        q: "Brauche ich eine neue Lernplattform?",
        a: "Nein. Die Suite ergänzt bestehende LMS- und IHK-Systeme — Inhalte und Lernfortschritt werden via Connector eingebunden.",
      },
      {
        q: "Wie schnell ist die Suite aktiv?",
        a: "Bei vorhandener Berufs-KI-Lizenz: sofort. Erste Empfehlungen entstehen nach 7 Tagen Aktivität.",
      },
    ],
  },

  pruefungsreife: {
    slug: "pruefungsreife",
    hero: {
      eyebrow: "Prüfungsreife Suite",
      title: "Vom Skill-Gap zur Prüfungsreife",
      subtitle:
        "Adaptiver Lernpfad aus dem Kompetenz-Graph, mit Recovery-Drills und transparenter Tutor-Evidenz.",
      primaryCta: { label: "Suite testen", href: "/berufs-ki/graph-activation" },
      secondaryCta: CTA_DEMO,
    },
    outcomes: [
      {
        title: "Persönlicher Lernpfad",
        body: "Next-Best-Skill-Empfehlungen direkt aus dem produktiven Intelligence-Graph.",
      },
      {
        title: "Recovery statt Frust",
        body: "Bei Lücken werden gezielte Drills mit Begründung statt Standard-Wiederholungen ausgespielt.",
      },
      {
        title: "Tutor mit Evidenz",
        body: "Jede Tutor-Antwort zeigt die Quelle aus Kompetenz, Lesson und Blueprint — kein Halluzinieren.",
      },
    ],
    features: [
      { title: "Skill-Path-Engine", body: "Deterministische Empfehlungen aus Skill-/Kompetenz-Graph." },
      { title: "Recovery-Drills", body: "Graph-basierte Übungen statt zufälliger Wiederholung." },
      { title: "Strict-RAG-Tutor", body: "Antworten mit Quellenangabe — refusal bei fehlender Evidenz." },
      { title: "Outcome-Tracking", body: "Messbare Fortschritte pro Kompetenz und Prüfungsbereich." },
    ],
    roi: [
      { label: "Bestehensrate", value: "+12pp", hint: "vs. ungeführter Lernpfad (interne Benchmarks)" },
      { label: "Lernzeit-Effizienz", value: "−30%", hint: "weniger Zeit bei gleichem Outcome" },
      { label: "Tutor-Halluzinationen", value: "0", hint: "Strict-RAG mit Pflicht-Citations" },
    ],
    pricing: [
      {
        name: "Azubi",
        audience: "1 Lernender",
        priceHint: "ab 24 €/Monat",
        includes: ["Skill-Path", "Recovery-Drills", "Strict-RAG-Tutor", "Outcome-Dashboard"],
        cta: { label: "Jetzt lernen", href: "/lernen" },
      },
      {
        name: "Cohort",
        audience: "Ausbildungsbetrieb, Cohort 10–500",
        priceHint: "individuell",
        includes: ["Alle Azubi-Features", "Cohort-Reporting", "Ausbilder-Sicht", "API-Integration"],
        cta: CTA_SALES,
        highlight: true,
      },
    ],
    proofPoints: [
      "Adaptive Empfehlungen ohne Black-Box: jede Empfehlung trägt Skill, Begründung und Outcome.",
      "Kompetenz-Graph deckt alle IHK-Prüfungsbereiche der hinterlegten Berufe ab.",
      "Mobile-first, offline-fähig für Lern-Sprints.",
    ],
    faqs: [
      {
        q: "Wie unterscheidet sich das von ExamFit?",
        a: "ExamFit ist die Prüfungssimulation. Die Prüfungsreife Suite ist der vorgelagerte adaptive Lernpfad — beide arbeiten zusammen.",
      },
      {
        q: "Kann ich eigene Inhalte einspielen?",
        a: "Ja — über den Curriculum-Import. Inhalte werden automatisch auf den Kompetenz-Graph gemappt.",
      },
    ],
  },

  risk_recovery: {
    slug: "risk_recovery",
    hero: {
      eyebrow: "Risk Recovery Suite",
      title: "Risiken früh erkennen. Wirkung messen.",
      subtitle:
        "Frühwarnsystem, gezielte Recovery-Maßnahmen und transparente Wirkungs-Reports — für Ausbildungsqualität und IHK-Audit.",
      primaryCta: { label: "Suite testen", href: "/berufs-ki/intelligence" },
      secondaryCta: CTA_DEMO,
    },
    outcomes: [
      {
        title: "Frühwarnung statt Notbremse",
        body: "Risiko-Patterns aus dem Recovery-Graph erkennen Schwächen bevor sie zur Prüfungsgefahr werden.",
      },
      {
        title: "Gezielte Recovery",
        body: "Empfehlungen pro Person mit Bezug zum konkreten Kompetenz-Lückenmuster.",
      },
      {
        title: "Wirkungsnachweis",
        body: "Vor-/Nach-Vergleich pro Recovery-Maßnahme — auditierbar und reportfähig.",
      },
    ],
    features: [
      { title: "Recovery-Graph", body: "Pattern-Library aus historischen Recovery-Erfolgen." },
      { title: "Risiko-Erklärungen", body: "Warum ist diese Person/Cohort gefährdet — mit Evidenz." },
      { title: "Wirkungs-Report", body: "Messung pro Maßnahme, Cohort und Zeitraum." },
      { title: "Audit-Trail", body: "Jeder Eingriff dokumentiert — IHK- und Compliance-fest." },
    ],
    roi: [
      { label: "Frühwarnung", value: "14 Tage", hint: "Median vor Eskalation" },
      { label: "Recovery-Erfolgsrate", value: "≥70%", hint: "wirksame Maßnahmen pro Pattern" },
      { label: "Reporting-Zeit", value: "−80%", hint: "vs. manuelles Auswerten" },
    ],
    pricing: [
      {
        name: "Standard",
        audience: "Ausbildungsleitung",
        priceHint: "ab 149 €/Monat",
        includes: ["Risiko-Erklärungen", "Recovery-Empfehlungen", "Standard-Reports"],
        cta: { label: "Suite starten", href: "/berufs-ki/intelligence" },
      },
      {
        name: "Audit",
        audience: "Multi-Standort + Compliance",
        priceHint: "individuell",
        includes: ["Alle Standard-Features", "Audit-Reports", "Custom-Patterns", "SSO"],
        cta: CTA_SALES,
        highlight: true,
      },
    ],
    proofPoints: [
      "Pattern-Detection aus aggregierten Lernverläufen — DSGVO-konform.",
      "Wirkungsmessung deterministisch — keine AI-Behauptungen ohne Daten.",
      "Anbindung an bestehende Ausbildungsdokumentation.",
    ],
    faqs: [
      {
        q: "Werden personenbezogene Daten geteilt?",
        a: "Nein. Pattern-Detection läuft innerhalb Ihrer Organisation. Cross-Org Insights sind opt-in und anonymisiert.",
      },
    ],
  },

  standort_intelligence: {
    slug: "standort_intelligence",
    hero: {
      eyebrow: "Standort Intelligence Suite",
      title: "Ausbildung über alle Standorte steuern",
      subtitle:
        "Standort-Vergleich, Cluster-Risiken und skalierbare Best-Practices — für Geschäftsführung und Multi-Standort-Verantwortliche.",
      primaryCta: { label: "Suite testen", href: "/berufs-ki/intelligence/executive" },
      secondaryCta: CTA_DEMO,
    },
    outcomes: [
      {
        title: "Standort-Transparenz",
        body: "Performance, Risiken und Best-Practices pro Standort vergleichbar — ohne manuelles Reporting.",
      },
      {
        title: "Cluster-Risiken",
        body: "Erkennen, wenn mehrere Standorte das gleiche strukturelle Problem haben.",
      },
      {
        title: "Best-Practice-Skalierung",
        body: "Erfolgreiche Maßnahmen anderer Standorte gezielt vorschlagen.",
      },
    ],
    features: [
      { title: "Executive Narrative", body: "Story der Ausbildung pro Standort und Konzern." },
      { title: "Cluster-Detection", body: "Strukturelle Probleme über Standorte hinweg." },
      { title: "Best-Practice-Engine", body: "Was funktioniert anderswo — übertragbar machen." },
      { title: "Multi-Standort-Cockpit", body: "Eine Sicht, alle Standorte, scoped permissions." },
    ],
    roi: [
      { label: "Konzern-Reporting", value: "−90%", hint: "vs. manuelle Konsolidierung" },
      { label: "Cluster-Erkennung", value: "Wochen früher", hint: "vs. Quartals-Reviews" },
      { label: "Best-Practice-Transfer", value: "messbar", hint: "Wirkungs-Tracking pro Übertragung" },
    ],
    pricing: [
      {
        name: "Enterprise",
        audience: "Multi-Standort & Konzern",
        priceHint: "individuell",
        includes: [
          "Executive Narrative",
          "Cluster-Detection",
          "Best-Practice-Engine",
          "SSO + SCIM + Scoped Roles",
          "Custom Reporting",
        ],
        cta: CTA_SALES,
        highlight: true,
      },
    ],
    proofPoints: [
      "Scoped Roles — jeder Standortleiter sieht nur den eigenen Bereich.",
      "Konzern-Cockpit mit aggregierten, anonymisierten Insights.",
      "Integrationen: SAP SuccessFactors, Personio, eigene HRIS via API.",
    ],
    faqs: [
      {
        q: "Kompatibel mit bestehender HR-Software?",
        a: "Ja — Standard-Connectoren für SAP SuccessFactors, Personio und API-basierte HRIS.",
      },
    ],
  },
};

export function getSuiteContent(slug: string): SuiteContent | null {
  return (SUITE_CONTENT as Record<string, SuiteContent>)[slug] ?? null;
}

export function allSuiteSlugs(): SuiteSlug[] {
  return Object.keys(SUITE_CONTENT) as SuiteSlug[];
}
