/**
 * BerufOS Module Registry — SSOT für alle Plattform-Module.
 *
 * Jedes Modul gehört zu BerufOS (Masterbrand). Live-Module deep-linken auf
 * existierende Produkte, Preview-Module zeigen erste Surface, Planned-Module
 * sammeln Waitlist (email_delivery_queue mit template_key=berufos_waitlist_<slug>).
 *
 * Verboten: neue Modul-Slugs außerhalb dieser Datei. Architecture-Guard prüft.
 */
import {
  GraduationCap,
  Briefcase,
  Bot,
  FileText,
  Workflow,
  Network,
  TrendingUp,
  Users,
  Building2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { BerufosModuleStatus } from "./brand";

export type BerufosPersona = "azubi" | "fachkraft" | "betrieb" | "institution" | "recruiter";

export interface BerufosModule {
  /** URL-Slug unter /berufos/<slug> */
  slug: string;
  /** Anzeigename (z.B. "ExamFit · LearningOS") */
  name: string;
  /** Kategorie-Suffix (z.B. "LearningOS") */
  category: string;
  /** Headline auf Modul-Landing */
  tagline: string;
  /** 1-Satz-Versprechen */
  promise: string;
  /** Status — steuert CTA-Verhalten */
  status: BerufosModuleStatus;
  /** Lucide-Icon */
  icon: LucideIcon;
  /** Akzent-Token (CSS-Variable Suffix) */
  accent: "petrol" | "indigo" | "amber" | "mint" | "rose" | "slate";
  /** Externes Deep-Link-Ziel für live/preview Module */
  href?: string;
  /** 3-6 Schlüsselfeatures */
  features: { title: string; body: string }[];
  /** Use-Cases pro Persona (für Hub-Filter) */
  personas: BerufosPersona[];
}

export const BERUFOS_MODULES: readonly BerufosModule[] = [
  {
    slug: "learning",
    name: "ExamFit",
    category: "LearningOS",
    tagline: "Prüfungen bestehen. Kompetenzen aufbauen.",
    promise:
      "Strukturierte Prüfungsvorbereitung mit AI-Tutor, Simulationen und Readiness-Score — für jeden Beruf.",
    status: "live",
    icon: GraduationCap,
    accent: "petrol",
    href: "https://examfit.de",
    features: [
      { title: "Lernkurse", body: "Kompetenzbasiert, prüfungsausgerichtet." },
      { title: "Mini-Checks", body: "Schwachstellen-Diagnose in 4 Minuten." },
      { title: "Prüfungssimulation", body: "Realistische Schriftliche + Mündliche." },
      { title: "AI-Tutor", body: "Strict-RAG mit Quellenpflicht — keine Halluzinationen." },
      { title: "Readiness-Score", body: "Täglich aktualisierter Prüfungszustand." },
    ],
    personas: ["azubi", "fachkraft"],
  },
  {
    slug: "workforce",
    name: "Berufs-KI",
    category: "WorkforceOS",
    tagline: "Produktiver arbeiten mit berufsspezifischer KI.",
    promise:
      "Berufs-Workflows, SOPs und Assistenz — strukturierte Ergebnisse statt Prompt-Bastelei.",
    status: "live",
    icon: Briefcase,
    accent: "indigo",
    href: "/berufs-ki",
    features: [
      { title: "Berufs-Workflows", body: "Vorgefertigte Profi-Abläufe pro Beruf." },
      { title: "SOPs & Vorlagen", body: "Strukturierte Standard-Arbeitsanweisungen." },
      { title: "Unternehmensprozesse", body: "Beschreiben, automatisieren, auditieren." },
      { title: "Knowledge Graph", body: "Berufslogik als zentraler Burggraben." },
    ],
    personas: ["fachkraft", "betrieb"],
  },
  {
    slug: "agents",
    name: "AgentOS",
    category: "Agent Runtime",
    tagline: "Berufsspezifische AI-Agenten orchestrieren.",
    promise:
      "Governance-first Agenten-Runtime mit HITL-Approval, Confidence-Gates und Multi-Agent-Flows.",
    status: "preview",
    icon: Bot,
    accent: "mint",
    href: "/admin/berufs-ki/agents",
    features: [
      { title: "Agent Registry", body: "Kommunikation · Workflow · Analyse · Compliance · Karriere · Recruiting." },
      { title: "HITL-Approval", body: "Human-in-the-loop bei niedrigem Confidence." },
      { title: "Multi-Agent-Orchestration", body: "Geführte Flows zwischen spezialisierten Agenten." },
      { title: "Audit Trail", body: "Jede Decision nachvollziehbar geloggt." },
    ],
    personas: ["betrieb", "institution"],
  },
  {
    slug: "documents",
    name: "DocumentOS",
    category: "AI-native Document Infrastructure",
    tagline: "Professionelle Unternehmensdokumente.",
    promise:
      "Branded PDFs, Vorlagen, Compliance-Review, Approval-Flows und Versionierung — alles AI-gesteuert.",
    status: "planned",
    icon: FileText,
    accent: "slate",
    features: [
      { title: "Vorlagen-Bibliothek", body: "Branchen- und berufsspezifische Templates." },
      { title: "Branding & Compliance", body: "Corporate Design + DSGVO automatisch." },
      { title: "Review & Approval", body: "Mehrstufige Freigabe mit Audit." },
      { title: "Versionierung", body: "Vollständige Historie pro Dokument." },
    ],
    personas: ["betrieb", "institution"],
  },
  {
    slug: "workflows",
    name: "WorkflowOS",
    category: "AI Workflow Runtime",
    tagline: "Geführte Arbeitsprozesse.",
    promise:
      "Multi-Step Flows mit Human-Review, Governance und Runtime-Analytics — kein Bastel-Tooling.",
    status: "planned",
    icon: Workflow,
    accent: "indigo",
    features: [
      { title: "Workflow Runtime", body: "Deterministisch, auditierbar, skalierbar." },
      { title: "Multi-Step Flows", body: "Komplexe Prozesse als geführte Schritte." },
      { title: "Human Review", body: "Approval-Punkte an kritischen Stellen." },
      { title: "Runtime Analytics", body: "Bottleneck- und Qualitäts-Insights." },
    ],
    personas: ["betrieb", "institution"],
  },
  {
    slug: "skills",
    name: "SkillGraph",
    category: "Kompetenz- & Berufsgraph",
    tagline: "Berufslogik verstehen.",
    promise:
      "Der zentrale Burggraben: Kompetenzen, Lernfelder, Blueprints, Rollen und SOPs — semantisch verbunden.",
    status: "preview",
    icon: Network,
    accent: "petrol",
    features: [
      { title: "190+ Curricula", body: "Berufs- und Studiengänge im SSOT." },
      { title: "Kompetenzbeziehungen", body: "Lernfeld → Kompetenz → Frage." },
      { title: "Blueprints", body: "Prüfungs-Struktur als Daten-Quelle." },
      { title: "Rollen & SOPs", body: "Brücke zwischen Lernen und Arbeit." },
    ],
    personas: ["azubi", "fachkraft", "betrieb", "recruiter"],
  },
  {
    slug: "career",
    name: "CareerOS",
    category: "Karriere- & Kompetenzentwicklung",
    tagline: "Skillentwicklung & Karrierepfade.",
    promise:
      "Strukturierte Entwicklung von der Ausbildung über Spezialisierung bis zur Führungsrolle.",
    status: "planned",
    icon: TrendingUp,
    accent: "amber",
    features: [
      { title: "Karrierepfade", body: "Berufslogik-basierte Entwicklungsrouten." },
      { title: "Skill-Gap-Analyse", body: "Was fehlt für den nächsten Schritt?" },
      { title: "Lern-Empfehlungen", body: "Direkt aus dem SkillGraph abgeleitet." },
    ],
    personas: ["azubi", "fachkraft"],
  },
  {
    slug: "recruit",
    name: "RecruitOS",
    category: "Recruiting & Talent Intelligence",
    tagline: "Kompetenzbasiertes Recruiting.",
    promise:
      "Kandidaten anhand echter Berufskompetenzen matchen — nicht anhand von Buzzword-CVs.",
    status: "planned",
    icon: Users,
    accent: "rose",
    features: [
      { title: "Kompetenz-Matching", body: "Skill-Graph statt Keyword-Suche." },
      { title: "Readiness-Score", body: "Objektive Prüfungs- und Praxis-Reife." },
      { title: "Talent Intelligence", body: "Pipeline-Insights pro Beruf." },
    ],
    personas: ["recruiter", "betrieb"],
  },
  {
    slug: "industry",
    name: "IndustryOS",
    category: "Branchenmodule",
    tagline: "Branchen-spezifische Operating Systems.",
    promise:
      "Vertikale Module mit fertiger Berufslogik: HausverwaltungOS, HandwerkOS, HealthcareOS, KanzleiOS, EducationOS.",
    status: "planned",
    icon: Building2,
    accent: "slate",
    features: [
      { title: "HausverwaltungOS", body: "Eigentümer · WEG · Mieter · Compliance." },
      { title: "HandwerkOS", body: "Aufträge · Kalkulation · Dokumentation." },
      { title: "HealthcareOS", body: "Pflege · Dokumentation · Qualitätsmanagement." },
      { title: "KanzleiOS", body: "Mandantenkommunikation · Akten · Compliance." },
      { title: "EducationOS", body: "Schulen · Berufsschulen · Bildungsträger." },
    ],
    personas: ["betrieb", "institution"],
  },
  {
    slug: "governance",
    name: "GovernanceOS",
    category: "AI Governance Layer",
    tagline: "Kontrolle, Auditierung und Sicherheit.",
    promise:
      "Architectural Continuity Guard, RLS-Audit, Audit-Trails und Compliance — die Governance-First-Garantie der Plattform.",
    status: "preview",
    icon: ShieldCheck,
    accent: "slate",
    href: "/admin/governance/architecture",
    features: [
      { title: "10 Architecture Rules", body: "SSOT_FIRST · NO_PARALLEL_SYSTEMS · AUDITABLE_MUTATIONS · u.a." },
      { title: "Audit-SSOT", body: "Alle Mutationen über fn_emit_audit + Contracts." },
      { title: "RLS überall", body: "Row-Level-Security ab Tabellen-Geburt." },
      { title: "Compliance-Ready", body: "DSGVO · Audit-Logs · Reviewable Actions." },
    ],
    personas: ["betrieb", "institution"],
  },
] as const;

export const BERUFOS_MODULE_SLUGS = BERUFOS_MODULES.map((m) => m.slug);

export function getModule(slug: string): BerufosModule | undefined {
  return BERUFOS_MODULES.find((m) => m.slug === slug);
}

export function modulesForPersona(persona?: BerufosPersona | null): readonly BerufosModule[] {
  if (!persona) return BERUFOS_MODULES;
  return BERUFOS_MODULES.filter((m) => m.personas.includes(persona));
}
