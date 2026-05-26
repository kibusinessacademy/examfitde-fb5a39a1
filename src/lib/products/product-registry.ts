/**
 * Product Registry SSOT v1 (2026-05-26).
 *
 * 4 Premium-Produktseiten. Statisch, deterministic, persona-aware CTAs.
 * Welle 2 wird DB-Layer (product_pages/_features/_faqs/_changelog) ergänzen
 * und diese Registry als Fallback halten.
 */

export type ProductSlug = "berufos" | "vertragscheckeros" | "ideenlosos" | "complianceos";

export type Persona = "default" | "unternehmer" | "hr" | "ausbildung" | "selbststaendig" | "institution";

export interface ProductCTA {
  /** Persona → CTA-Label + Ziel (Route oder externer Link). */
  default: { label: string; href: string };
  unternehmer?: { label: string; href: string };
  hr?: { label: string; href: string };
  ausbildung?: { label: string; href: string };
  selbststaendig?: { label: string; href: string };
  institution?: { label: string; href: string };
}

export interface ProductFAQ {
  question: string;
  answer: string;
}

export interface ProductDef {
  slug: ProductSlug;
  name: string;
  category: string;
  status: "live" | "preview" | "planned";
  hero: {
    eyebrow: string;
    headline: string;
    subline: string;
  };
  usps: { title: string; body: string }[];
  cta: ProductCTA;
  transparencyNote?: string;
  faqs: ProductFAQ[];
  /** SEO meta */
  meta: {
    title: string;
    description: string;
  };
}

export const TRUST_PILLARS = [
  { title: "DSGVO-konform", body: "Datenverarbeitung nach europäischem Standard." },
  { title: "EU AI Act ready", body: "Transparenzpflichten erfüllt, verbotene Praktiken ausgeschlossen." },
  { title: "Made in Germany", body: "Entwickelt und betrieben aus Baden-Württemberg." },
  { title: "Human-in-the-loop", body: "Kritische Entscheidungen bleiben beim Menschen." },
  { title: "Auditierbar", body: "Jede Mutation hinterlässt eine Spur — vollständig nachvollziehbar." },
  { title: "Rollenbasierte Sicherheit", body: "Granulare Berechtigungen, Minimalprinzip, Fail-Closed." },
  { title: "Kein Blackbox-System", body: "KI-Ausgaben sind erklärbar und überprüfbar." },
];

export const PRODUCTS: Record<ProductSlug, ProductDef> = {
  berufos: {
    slug: "berufos",
    name: "BerufOS",
    category: "AI-native Unternehmensplattform",
    status: "live",
    hero: {
      eyebrow: "Die Plattform",
      headline: "Die erste AI-native Unternehmensplattform, die Arbeit versteht — nicht nur Texte.",
      subline:
        "BerufOS analysiert Prozesse, Dokumente, Workflows und operative Schwächen automatisch und verwandelt KI von „Antworten“ in echte Arbeitserledigung.",
    },
    usps: [
      { title: "KI-native Unternehmensplattform", body: "Kein Chatbot, kein Prompt-Spielzeug — kontrollierte Arbeitsmaschine." },
      { title: "Berufs- und branchenspezifische Intelligenz", body: "Versteht echte berufliche Strukturen, nicht generische Texte." },
      { title: "DSGVO- & EU-AI-Act-konform", body: "Architektur ist auf europäische Regulierung ausgelegt." },
      { title: "Human-in-the-loop Governance", body: "Strukturell verankert, nicht nur optional." },
      { title: "Selbstoptimierende Workflows", body: "Workflows lernen, was wirklich Outcomes erzeugt." },
      { title: "Auditierbare Entscheidungen", body: "Jede Mutation ist mit Quelle, Zeit und Outcome verkettet." },
      { title: "Sicherheits- und Compliance-Engine integriert", body: "Capability-gated. Approval-controlled. Evidence-based." },
      { title: "Ein System für Dokumente, Prozesse und Wissen", body: "Keine Tool-Fragmentierung — eine kontrollierte Schicht." },
    ],
    cta: {
      default: { label: "Live-Demo starten", href: "/demo" },
      unternehmer: { label: "Unternehmen analysieren", href: "/produkte/ideenlosos" },
      hr: { label: "HR-Workflows entdecken", href: "/authority" },
      ausbildung: { label: "Ausbildung digitalisieren", href: "/berufs-ki" },
      selbststaendig: { label: "Vertrag prüfen lassen", href: "/produkte/vertragscheckeros" },
      institution: { label: "Live-Beratung buchen", href: "/demo" },
    },
    faqs: [
      { question: "Was unterscheidet BerufOS von einem Chatbot?", answer: "BerufOS erledigt kontrolliert operative Arbeit — auditierbar, governance-fähig, mit Human-in-the-loop dort, wo es zählt. Chatbots antworten; BerufOS arbeitet." },
      { question: "Ist BerufOS DSGVO-konform?", answer: "Ja. Personenbezogene Daten werden ausschließlich gemäß DSGVO verarbeitet. Zugriffsschutz, rollenbasierte Berechtigungen, Verschlüsselung und Audit-Logs sind Standard." },
      { question: "Ersetzt die KI menschliche Entscheidungen?", answer: "Nein. Kritische Entscheidungen verbleiben beim Nutzer. BerufOS arbeitet nach dem Human-in-the-loop-Prinzip und unterstützt — entscheidet aber nicht autonom über rechtliche oder behördliche Sachverhalte." },
      { question: "Welche Branchen werden unterstützt?", answer: "BerufOS deckt regulierte Mittelstands-Domänen ab: HR, Ausbildung, Compliance, Vertragsmanagement, Bildungsträger, Industrie- und Handwerksbetriebe." },
      { question: "Ist die Plattform EU-AI-Act-konform?", answer: "Ja. KI-Nutzung ist transparent gekennzeichnet, verbotene Praktiken ausgeschlossen, kritische Funktionen sind auditierbar und menschlich kontrollierbar." },
    ],
    meta: {
      title: "BerufOS — AI-native Unternehmensplattform",
      description: "BerufOS verwandelt KI von einem Antwortsystem in eine kontrollierte Arbeitsmaschine. DSGVO- & EU-AI-Act-konform, auditierbar, human-in-the-loop.",
    },
  },

  vertragscheckeros: {
    slug: "vertragscheckeros",
    name: "VertragscheckerOS",
    category: "Premium-KI für Vertragsanalyse",
    status: "live",
    hero: {
      eyebrow: "VertragscheckerOS",
      headline: "Verträge intelligent prüfen. Risiken früher erkennen.",
      subline:
        "Die Premium-KI für Unternehmen, HR, Bildungsträger und Selbstständige.",
    },
    usps: [
      { title: "Risikoanalyse in Sekunden", body: "Vertragstexte werden strukturell zerlegt und auf typische Risikomuster geprüft." },
      { title: "Klauselprüfung nach Best Practices", body: "Branchenstandards und juristische Heuristiken in einer Engine." },
      { title: "Struktur- & Verständlichkeitsanalyse", body: "Erkennt unklare Formulierungen, asymmetrische Pflichten, fehlende Schutzklauseln." },
      { title: "Compliance- & Governance-Checks", body: "DSGVO, NachweisG, AGG, befristete Verträge — automatisch geflaggt." },
      { title: "Human Review Workflow", body: "Jeder Flag ist ein Vorschlag — die Freigabe bleibt beim Menschen." },
      { title: "Auditierbare Prüfprozesse", body: "Jeder Prüflauf hinterlässt einen vollständigen, exportierbaren Audit-Trail." },
      { title: "Keine Blackbox-KI", body: "Jeder Befund verweist auf Klausel, Quelle und Regel." },
    ],
    cta: {
      default: { label: "Vertrag prüfen", href: "/demo?product=vertragscheckeros" },
      hr: { label: "HR-Verträge prüfen", href: "/demo?product=vertragscheckeros&persona=hr" },
      selbststaendig: { label: "Freelancer-Vertrag prüfen", href: "/demo?product=vertragscheckeros&persona=selbststaendig" },
      institution: { label: "Live-Beratung buchen", href: "/demo" },
    },
    transparencyNote:
      "Die Analyse stellt keine Rechtsberatung dar, sondern eine strukturierte Vorprüfung zur Unterstützung menschlicher Entscheidungen.",
    faqs: [
      { question: "Ersetzt VertragscheckerOS einen Anwalt?", answer: "Nein. Es ist eine strukturierte Vorprüfung. Die Analyse beschleunigt die juristische Bewertung — ersetzt sie aber nicht." },
      { question: "Welche Vertragsarten werden unterstützt?", answer: "Arbeitsverträge, Ausbildungsverträge, Dienstleistungs- und Freelancer-Verträge, Geheimhaltungsvereinbarungen und Standard-AGB-Bündel." },
      { question: "Bleiben meine Dokumente vertraulich?", answer: "Ja. Verarbeitung erfolgt DSGVO-konform, verschlüsselt und nach Minimalprinzip. Keine Weitergabe an Dritte." },
      { question: "Welche Compliance-Checks laufen automatisch?", answer: "DSGVO-Klauseln, NachweisG-Pflichtangaben, Befristungsrecht, AGG-Risiken, fehlende Schutzklauseln." },
    ],
    meta: {
      title: "VertragscheckerOS — KI-Vertragsanalyse mit Audit-Trail",
      description: "Premium-KI für Vertragsanalyse: Risikoanalyse in Sekunden, Klauselprüfung, Compliance-Checks. DSGVO-konform, auditierbar, mit Human-Review-Workflow.",
    },
  },

  ideenlosos: {
    slug: "ideenlosos",
    name: "IdeenlosOS",
    category: "Automatische Potenzialanalyse",
    status: "live",
    hero: {
      eyebrow: "IdeenlosOS",
      headline: "Keine Idee, wo KI helfen kann? IdeenlosOS findet es für Sie.",
      subline:
        "Die Plattform analysiert Unternehmensunterlagen, Prozesse und Arbeitsabläufe und erkennt automatisch konkrete Automatisierungs- und Effizienzpotenziale.",
    },
    usps: [
      { title: "Erkennt operative Schwächen automatisch", body: "Strukturelle Engpässe werden ohne Workshop sichtbar." },
      { title: "Analysiert Dokumente & Vorgänge", body: "Vertrieb, HR, Buchhaltung, Operations — eine einheitliche Sicht." },
      { title: "Branchen- & berufsbezogene KI", body: "Erkennt Mustern in echten beruflichen Strukturen, nicht generisch." },
      { title: "Erkennt repetitive Prozesse", body: "Wiederkehrende Handgriffe werden quantifiziert und priorisiert." },
      { title: "Sofort umsetzbare Workflows", body: "Jeder Befund kommt mit konkretem Vorschlag — kein Beratergeschwurbel." },
      { title: "Priorisiert nach ROI & Zeitersparnis", body: "Was zuerst angehen? IdeenlosOS rechnet es vor." },
      { title: "Human-in-the-loop statt Blindautomatisierung", body: "Sie entscheiden, was umgesetzt wird." },
    ],
    cta: {
      default: { label: "KI-Potenziale erkennen", href: "/demo?product=ideenlosos" },
      unternehmer: { label: "Unternehmen analysieren", href: "/demo?product=ideenlosos&persona=unternehmer" },
      institution: { label: "Live-Beratung buchen", href: "/demo" },
    },
    faqs: [
      { question: "Was bekomme ich konkret?", answer: "Eine priorisierte Liste umsetzbarer Workflow- und Automatisierungschancen mit ROI-Schätzung, Aufwand und konkretem Umsetzungsvorschlag." },
      { question: "Wie lange dauert die Analyse?", answer: "Erste Befunde liegen innerhalb von Minuten vor — eine vollständige Tiefenanalyse je nach Datenmenge in wenigen Stunden." },
      { question: "Welche Daten brauche ich?", answer: "Bestehende Prozessdokumentationen, Stellenbeschreibungen, Workflows oder Beispieldokumente reichen für den Start." },
      { question: "Werden Daten weitergegeben?", answer: "Nein. Verarbeitung erfolgt DSGVO-konform, verschlüsselt und ausschließlich für Ihre Analyse." },
    ],
    meta: {
      title: "IdeenlosOS — Automatische KI-Potenzialanalyse für Unternehmen",
      description: "IdeenlosOS analysiert Prozesse, Dokumente und Workflows und liefert priorisierte, sofort umsetzbare Automatisierungsvorschläge. DSGVO-konform.",
    },
  },

  complianceos: {
    slug: "complianceos",
    name: "ComplianceOS",
    category: "Compliance, Datenschutz & Governance",
    status: "live",
    hero: {
      eyebrow: "ComplianceOS",
      headline: "Compliance, Datenschutz und Governance als integrierte Plattformfunktion.",
      subline:
        "Erkennt Compliance-Drift, sammelt Audit-Evidence und erzwingt Approval-Logik — über alle BerufOS-Module hinweg.",
    },
    usps: [
      { title: "DSGVO-Checks", body: "Strukturierte Prüfung nach europäischem Standard." },
      { title: "EU AI Act Transparenz", body: "Kennzeichnung, Risiko-Klassifizierung, menschliche Aufsicht." },
      { title: "Audit-Logs & Nachvollziehbarkeit", body: "Jede Mutation mit Quelle, Zeit, Akteur, Outcome." },
      { title: "Rollen- & Rechtekonzepte", body: "Granulare Berechtigungen nach Minimalprinzip." },
      { title: "Sicherheitswarnungen", body: "Frühwarnsystem für Compliance- und Sicherheitsdrift." },
      { title: "Governance-first Architektur", body: "Capabilities, Approvals, Risk-Level sind erste-Klasse-Konstrukte." },
      { title: "Fail-Closed-Prinzip", body: "Im Zweifel wird blockiert — nie unkontrolliert ausgeführt." },
    ],
    cta: {
      default: { label: "Compliance-Check starten", href: "/demo?product=complianceos" },
      hr: { label: "HR-Compliance prüfen", href: "/demo?product=complianceos&persona=hr" },
      institution: { label: "Audit-Workshop buchen", href: "/demo" },
    },
    faqs: [
      { question: "Welche Frameworks deckt ComplianceOS ab?", answer: "DSGVO, EU AI Act, NachweisG-Pflichten, branchenspezifische Standards (z.B. HinSchG, GoBD)." },
      { question: "Wer kann Audit-Logs einsehen?", answer: "Nur explizit berechtigte Rollen. Zugriffe werden ihrerseits protokolliert." },
      { question: "Ist ComplianceOS auch für Einzelunternehmen geeignet?", answer: "Ja. Die Plattform skaliert vom Solo-Selbstständigen bis zum Mittelstand mit mehreren hundert Nutzern." },
      { question: "Was bedeutet Fail-Closed-Prinzip?", answer: "Wenn ein kritischer Check nicht eindeutig passiert, blockiert das System die Aktion — statt sie unkontrolliert auszuführen." },
    ],
    meta: {
      title: "ComplianceOS — DSGVO, EU AI Act, Audit-Logs in einer Plattform",
      description: "Compliance, Datenschutz und Governance als integrierte Plattformfunktion. Audit-Logs, Rollenkonzepte, Fail-Closed-Prinzip. DSGVO- & EU-AI-Act-ready.",
    },
  },
};

export const PRODUCT_SLUGS = Object.keys(PRODUCTS) as ProductSlug[];

export function getProduct(slug: string): ProductDef | undefined {
  return PRODUCTS[slug as ProductSlug];
}
