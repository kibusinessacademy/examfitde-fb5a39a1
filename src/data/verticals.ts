/**
 * BerufOS Vertical Intelligence — Branchen-SSOT
 *
 * 11 produktisierte Branchenbetriebssysteme für den deutschen Mittelstand.
 * Positionierung: "Der digitale Branchenmitarbeiter" — nicht "AI-Plattform".
 *
 * Pricing-SSOT: src/config/verticalPricing.ts
 * Diese Datei ist Marketing-Content, keine Business-Logik.
 */

export type VerticalSlug =
  | "praxis"
  | "steuer"
  | "verwaltung"
  | "notar"
  | "handwerk"
  | "gartenbau"
  | "pflege"
  | "krankenkasse"
  | "kanzlei"
  | "makler"
  | "foerdermittel";

export interface VerticalDefinition {
  slug: VerticalSlug;
  /** Brand-Name, immer in Form "<X>OS" */
  brand: string;
  /** Kurz-Tagline für Cards / Hero */
  tagline: string;
  /** Ein-Satz-Promise für SEO meta description */
  metaDescription: string;
  /** Zielgruppe Plain Text */
  audience: string;
  /** 4–6 konkrete Pain Points der Branche */
  painPoints: string[];
  /** Beispielhafte Vorgänge / Workflows */
  exampleWorkflows: string[];
  /** Icon-Emoji (provisorisch, später durch SVG ersetzbar) */
  emoji: string;
  /** Akzent-HSL für Card-Border (semantisches Token bevorzugt) */
  accent: "petrol" | "mint" | "amber" | "rose" | "violet" | "slate";
}

export const VERTICALS: VerticalDefinition[] = [
  {
    slug: "praxis",
    brand: "PraxisOS",
    tagline: "Der digitale Praxisassistent für kleine Arztpraxen.",
    metaDescription:
      "PraxisOS entlastet Arztpraxen bei Dokumentation, Patientenkommunikation, Terminchaos und DSGVO. EU-gehostet, AI-Act-ready.",
    audience: "Hausärzte, Fachärzte, Zahnärzte, MVZ bis 15 Mitarbeitende",
    painPoints: [
      "Telefon-Stau und Terminchaos im Empfang",
      "Manuelle Patientenkommunikation frisst Stunden",
      "Dokumentationslast nach jedem Patienten",
      "DSGVO-Unsicherheit bei jeder digitalen Lösung",
      "Personalausfall ohne Vertretung",
    ],
    exampleWorkflows: [
      "Tagesbrief: Was ist heute wichtig?",
      "Patientenanfragen klassifizieren + vorformulieren",
      "Dokumentations-Assistent nach Konsultation",
      "Fristen- und Recall-Erinnerungen",
    ],
    emoji: "🏥",
    accent: "mint",
  },
  {
    slug: "steuer",
    brand: "SteuerOS",
    tagline: "Der digitale Steuerbüro-Assistent.",
    metaDescription:
      "SteuerOS automatisiert Mandantenkommunikation, Fristen, Rückfragen und DATEV-Workflows. EU-gehostet, DSGVO-konform.",
    audience: "Steuerberater, Steuerbüros, Kanzleien mit Steuerabteilung",
    painPoints: [
      "Mandantenrückfragen mehrfach pro Woche",
      "Fristen- und Belegchaos zu Quartalsende",
      "Repetitive Standardantworten an Mandanten",
      "DATEV-Übergaben und Belegnachforderungen",
      "Wissen verteilt auf E-Mail, Ordner, DATEV",
    ],
    exampleWorkflows: [
      "Mandanten-Inbox: Antworten vorformulieren",
      "Belege-Checklisten für Quartalsabschluss",
      "Frist-Eskalations-Workflow",
      "Mandanten-Statusbericht auf Knopfdruck",
    ],
    emoji: "📊",
    accent: "petrol",
  },
  {
    slug: "verwaltung",
    brand: "VerwaltungsOS",
    tagline: "Der digitale Verwaltungsassistent für Behörden und Kommunen.",
    metaDescription:
      "VerwaltungsOS entlastet Sachbearbeiter bei Bürgeranfragen, Formularen und Fristen. EU-souverän, AI-Act-konform, auditierbar.",
    audience: "Kommunen, Ämter, Stadtverwaltungen, Landratsämter",
    painPoints: [
      "Bürgeranfragen in mehreren Sprachen",
      "Formular-Chaos zwischen Abteilungen",
      "Lange Antwortzeiten wegen Personalmangel",
      "Fristen-Compliance und Aktenführung",
      "Wissen in den Köpfen einzelner Sachbearbeiter",
    ],
    exampleWorkflows: [
      "Bürgeranfragen klassifizieren + Antwortentwurf",
      "Formular-Wegweiser für Bürger",
      "Frist-Cockpit pro Vorgang",
      "Interner Wissens-Copilot",
    ],
    emoji: "🏛️",
    accent: "slate",
  },
  {
    slug: "notar",
    brand: "NotarOS",
    tagline: "Der digitale Notariatsassistent.",
    metaDescription:
      "NotarOS unterstützt Notariate bei Dokumenten, Checklisten und Fehlervermeidung. EU-gehostet, mit voller Auditierbarkeit.",
    audience: "Notare, Notariate, Notar-Sozietäten",
    painPoints: [
      "Komplexe Urkunden-Vorbereitung",
      "Mandantenkommunikation rund um Termine",
      "Checklisten für jede Beurkundungsart",
      "Fehlervermeidung bei wiederkehrenden Klauseln",
      "Termin- und Fristen-Koordination",
    ],
    exampleWorkflows: [
      "Beurkundungs-Checklisten generieren",
      "Mandanten-Vorab-Kommunikation",
      "Dokumenten-Prüf-Assistent (Human-in-the-Loop)",
      "Beurkundungs-Nachbereitung",
    ],
    emoji: "⚖️",
    accent: "slate",
  },
  {
    slug: "handwerk",
    brand: "HandwerkOS",
    tagline: "Der digitale Handwerks-Assistent.",
    metaDescription:
      "HandwerkOS automatisiert Angebote, Baustellen-Kommunikation, Nachträge und Dokumentation. Made for SHK, Elektro, Maler, Trockenbau.",
    audience: "Handwerksbetriebe 1–30 Mitarbeitende, Meister, Bauleiter",
    painPoints: [
      "Angebote schreiben am Abend nach der Baustelle",
      "Kundenkommunikation per WhatsApp und Telefon",
      "Baustellen-Dokumentation und Nachträge",
      "Materialbeschaffung und Lieferanten-Pings",
      "Rechnungsstellung verzögert sich",
    ],
    exampleWorkflows: [
      "Angebot aus Sprachnotiz erstellen",
      "Kunden-Antwort vorformulieren",
      "Baustellen-Tagesbericht generieren",
      "Nachtrag dokumentieren + abrechnungsreif machen",
    ],
    emoji: "🔧",
    accent: "amber",
  },
  {
    slug: "gartenbau",
    brand: "GartenbauOS",
    tagline: "Der digitale Garten- und Landschaftsbau-Assistent.",
    metaDescription:
      "GartenbauOS koordiniert Einsatzplanung, Wetter, Angebote und Mitarbeiter. Für GaLaBau-Betriebe im DACH-Raum.",
    audience: "GaLaBau-Betriebe, Landschaftsgärtner, Pflegedienste Außenanlagen",
    painPoints: [
      "Einsatzplanung wackelt mit dem Wetter",
      "Angebote für individuelle Projekte",
      "Kundenkommunikation während Bauphase",
      "Mitarbeiterkoordination in der Saison",
      "Wartungsverträge nachhalten",
    ],
    exampleWorkflows: [
      "Wetter-adaptive Tagesplanung",
      "Angebot mit Foto-Aufnahme generieren",
      "Kunden-Status-Updates automatisch",
      "Wartungsvertrags-Erinnerungen",
    ],
    emoji: "🌿",
    accent: "mint",
  },
  {
    slug: "pflege",
    brand: "PflegeOS",
    tagline: "Der digitale Pflege- und Klinik-Assistent.",
    metaDescription:
      "PflegeOS entlastet Pflegekräfte und Stationen bei Dokumentation, Übergaben und Kommunikation. DSGVO- und AI-Act-konform.",
    audience: "Pflegeheime, ambulante Pflegedienste, kleinere Kliniken, MVZ",
    painPoints: [
      "Pflege-Dokumentation kostet die meiste Zeit",
      "Schicht-Übergaben unvollständig",
      "Eskalationen brauchen klare Routen",
      "Angehörigen-Kommunikation überlastet",
      "Fachkräftemangel = Überstunden",
    ],
    exampleWorkflows: [
      "Schicht-Übergabebericht generieren",
      "Pflegedokumentations-Assistent",
      "Eskalationsprotokoll mit klarer Route",
      "Angehörigen-Update vorformulieren",
    ],
    emoji: "🩺",
    accent: "rose",
  },
  {
    slug: "krankenkasse",
    brand: "KasseOS",
    tagline: "Der digitale Krankenkassen-Assistent.",
    metaDescription:
      "KasseOS automatisiert Anfragen, Freigaben und Compliance-Prüfungen für Krankenkassen und Versicherer. EU-souverän.",
    audience: "Krankenkassen, GKV-Dienstleister, private Versicherer",
    painPoints: [
      "Versichertenanfragen in hohem Volumen",
      "Freigabe-Prozesse mit vielen Beteiligten",
      "Compliance-Prüfung jeder Antwort",
      "Dokumentations-Pflichten",
      "Eskalationen bei Widersprüchen",
    ],
    exampleWorkflows: [
      "Anfragen klassifizieren + Antwortentwurf",
      "Freigabe-Workflow mit Audit-Trail",
      "Compliance-Pre-Check",
      "Widerspruchs-Vorlagen",
    ],
    emoji: "🛡️",
    accent: "petrol",
  },
  {
    slug: "kanzlei",
    brand: "KanzleiOS",
    tagline: "Der digitale Kanzlei-Assistent.",
    metaDescription:
      "KanzleiOS unterstützt Anwaltskanzleien bei Schriftsätzen, Mandantenkommunikation und Fristen. DSGVO- und BRAO-konform.",
    audience: "Rechtsanwaltskanzleien, Sozietäten, Inhouse-Legal-Teams",
    painPoints: [
      "Schriftsatz-Entwürfe aus Akten",
      "Mandanten-Updates während Verfahren",
      "Fristen-Kontrolle pro Akte",
      "Recherche zu Standardfragen",
      "Repetitive Vertragsklauseln",
    ],
    exampleWorkflows: [
      "Mandanten-Update-Brief vorformulieren",
      "Schriftsatz-Entwurf aus Aktenlage",
      "Fristen-Cockpit pro Akte",
      "Klausel-Bibliothek mit Vorschlag",
    ],
    emoji: "📜",
    accent: "slate",
  },
  {
    slug: "makler",
    brand: "MaklerOS",
    tagline: "Der digitale Makler- und Immobilien-Assistent.",
    metaDescription:
      "MaklerOS automatisiert Exposés, Anfragen-Triage und Besichtigungs-Koordination. Für Makler, Hausverwaltungen und Bauträger.",
    audience: "Immobilienmakler, Hausverwaltungen, Bauträger, WEG-Verwalter",
    painPoints: [
      "Anfragen-Flut auf jede Anzeige",
      "Exposé-Erstellung kostet Zeit",
      "Besichtigungs-Koordination per E-Mail",
      "Mieterkommunikation in Hausverwaltung",
      "Dokumentations-Pflichten WEG/Mieter",
    ],
    exampleWorkflows: [
      "Anfragen-Triage mit Vorqualifizierung",
      "Exposé-Erstgenerierung",
      "Besichtigungs-Slots koordinieren",
      "Mieter-Update vorformulieren",
    ],
    emoji: "🏠",
    accent: "amber",
  },
  {
    slug: "foerdermittel",
    brand: "FördermittelOS",
    tagline: "Der digitale Fördermittel-Assistent.",
    metaDescription:
      "FördermittelOS findet passende Förderungen und unterstützt bei Antragserstellung. Für Berater, KMU und Verbände.",
    audience: "Fördermittelberater, KMU mit Investitionsplänen, Verbände",
    painPoints: [
      "Förderlandschaft unübersichtlich",
      "Antragsanforderungen je Programm anders",
      "Fristen über mehrere Programme parallel",
      "Verwendungsnachweise nach Bewilligung",
      "Kommunikation mit Fördergeber",
    ],
    exampleWorkflows: [
      "Förderscan: passende Programme finden",
      "Antrags-Checkliste je Programm",
      "Verwendungsnachweis-Assistent",
      "Fördergeber-Kommunikation vorformulieren",
    ],
    emoji: "💶",
    accent: "violet",
  },
];

export function getVertical(slug: string): VerticalDefinition | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}
