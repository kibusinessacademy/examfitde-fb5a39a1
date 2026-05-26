/**
 * Legal SSOT v2 (2026-05-26) — BerufOS Impressum + AGB.
 *
 * Wortgetreuer Text vom Inhaber. Single source of truth für /impressum + /agb.
 * Bei Änderungen NUR hier editieren — Pages rendern aus dieser Datei.
 */

export const LEGAL_LAST_UPDATED = "2026-05-26";

export const IMPRESSUM = {
  provider: {
    name: "BerufOS – Diana Keil Einzelunternehmen",
    street: "Elsa-Brandström-Str. 4",
    city: "76676 Graben-Neudorf",
    country: "Deutschland",
    phone: "+49 15566 775536",
    email: "info@dianakeil.com",
    owner: "Diana Keil",
  },
  contentResponsible: {
    name: "Diana Keil",
    street: "Elsa-Brandström-Str. 4",
    city: "76676 Graben-Neudorf",
  },
  aiTransparency: {
    intro: "BerufOS nutzt künstliche Intelligenz zur Unterstützung bei:",
    purposes: [
      "Analyse von Dokumenten",
      "Strukturierung von Informationen",
      "Workflow-Vorschlägen",
      "Automatisierungen",
      "simulationsbasierten Bewertungen",
      "Wissens- und Prozessunterstützung",
    ],
    disclaimer:
      "Die KI-Ausgaben dienen ausschließlich als unterstützende Handlungsempfehlungen und ersetzen keine:",
    notReplacing: [
      "Rechtsberatung",
      "Steuerberatung",
      "Unternehmensberatung",
      "behördliche Entscheidung",
      "menschliche Prüfungspflicht",
    ],
    closing: "Alle kritischen Entscheidungen verbleiben beim Nutzer.",
    principlesIntro: "BerufOS arbeitet nach folgenden Grundprinzipien:",
    principles: [
      "Human-in-the-loop",
      "nachvollziehbare KI-Ausgaben",
      "keine vollautomatischen Rechtsentscheidungen",
      "DSGVO-konforme Verarbeitung",
      "protokollierte Systemaktionen",
      "rollenbasierte Zugriffssteuerung",
      "Fail-Closed-Prinzip bei kritischen Prozessen",
    ],
  },
  liability: [
    "Die Inhalte dieser Website wurden mit größter Sorgfalt erstellt. Für Vollständigkeit, Richtigkeit und Aktualität wird jedoch keine Gewähr übernommen.",
    "KI-generierte Inhalte können trotz technischer und organisatorischer Maßnahmen Fehler enthalten. Nutzer sind verpflichtet, Ergebnisse eigenständig zu prüfen.",
  ],
  copyright:
    "Alle Inhalte, Texte, Konzepte, Grafiken, UX-Komponenten, Automatisierungslogiken, Marken und Plattformstrukturen von BerufOS unterliegen dem deutschen Urheberrecht. Eine Nutzung, Vervielfältigung oder Verbreitung bedarf der ausdrücklichen schriftlichen Zustimmung.",
  privacyShort:
    "Personenbezogene Daten werden ausschließlich gemäß DSGVO verarbeitet. Weitere Informationen befinden sich in der Datenschutzerklärung.",
} as const;

export interface AgbClause {
  number: number;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  bulletsAfterIndex?: number; // index of paragraph after which bullets render
}

export const AGB_CLAUSES: AgbClause[] = [
  {
    number: 1,
    title: "Geltungsbereich",
    paragraphs: [
      "Diese Allgemeinen Geschäftsbedingungen gelten für sämtliche Leistungen der Plattform BerufOS, betrieben durch:",
      "BerufOS – Diana Keil Einzelunternehmen",
      "Die Leistungen richten sich an:",
    ],
    bullets: [
      "Unternehmer",
      "Selbstständige",
      "Bildungsträger",
      "Ausbildungsbetriebe",
      "Organisationen",
      "Verbraucher (soweit ausdrücklich ausgewiesen)",
    ],
  },
  {
    number: 2,
    title: "Vertragsgegenstand",
    paragraphs: [
      "BerufOS bietet digitale Software-, KI-, Analyse-, Workflow- und Automatisierungsleistungen an.",
      "Dazu gehören insbesondere:",
      "Leistungsumfang und Funktionsumfang ergeben sich aus der jeweiligen Produktbeschreibung.",
    ],
    bullets: [
      "KI-gestützte Assistenten",
      "Dokumentenanalysen",
      "Lern- und Prüfungsplattformen",
      "Simulationssysteme",
      "Workflow-Automationen",
      "Unternehmens- und Wissenssysteme",
      "Analyse- und Reportingfunktionen",
    ],
    bulletsAfterIndex: 1,
  },
  {
    number: 3,
    title: "KI-gestützte Leistungen",
    paragraphs: [
      "Der Nutzer erkennt an:",
      "BerufOS verpflichtet sich zu:",
    ],
    bullets: [
      "KI-Systeme liefern Wahrscheinlichkeiten und keine Garantien.",
      "BerufOS ersetzt keine Rechts-, Steuer- oder Fachberatung.",
      "KI-Ausgaben müssen eigenständig geprüft werden.",
      "Kritische Entscheidungen dürfen nicht ausschließlich automatisiert erfolgen.",
      "nachvollziehbaren Systemprozessen",
      "Transparenz über KI-Nutzung",
      "Governance-Mechanismen",
      "Sicherheits- und Datenschutzmaßnahmen",
    ],
  },
  {
    number: 4,
    title: "Vertragsschluss",
    paragraphs: [
      "Der Vertrag kommt zustande durch:",
      "BerufOS kann Bestellungen ohne Angabe von Gründen ablehnen.",
    ],
    bullets: [
      "Bestellung über die Plattform",
      "digitale Buchung",
      "Annahme eines Angebots",
      "Aktivierung eines kostenpflichtigen Zugangs",
    ],
  },
  {
    number: 5,
    title: "Preise und Zahlungsbedingungen",
    paragraphs: [
      "Alle Preise verstehen sich in Euro.",
      "Es gelten die zum Zeitpunkt der Bestellung angegebenen Preise.",
      "Zahlungsanbieter können sein:",
      "Abonnements verlängern sich automatisch, sofern sie nicht fristgerecht gekündigt werden.",
    ],
    bullets: ["Stripe", "Klarna", "Lovable Payments", "weitere integrierte Zahlungsdienste"],
    bulletsAfterIndex: 2,
  },
  {
    number: 6,
    title: "Nutzungsrechte",
    paragraphs: [
      "Der Nutzer erhält ein einfaches, nicht übertragbares Nutzungsrecht für die Dauer des Vertrags.",
      "Nicht erlaubt:",
    ],
    bullets: [
      "Weiterverkauf",
      "Massenexporte",
      "Reverse Engineering",
      "missbräuchliche Automatisierung",
      "Umgehung technischer Schutzmaßnahmen",
    ],
  },
  {
    number: 7,
    title: "Verfügbarkeit",
    paragraphs: [
      "BerufOS bemüht sich um eine hohe Verfügbarkeit.",
      "Wartungen, Sicherheitsmaßnahmen, Updates oder höhere Gewalt können zu temporären Einschränkungen führen.",
      "Ein Anspruch auf permanente Verfügbarkeit besteht nicht.",
    ],
  },
  {
    number: 8,
    title: "Datenschutz und Sicherheit",
    paragraphs: ["BerufOS verarbeitet Daten gemäß DSGVO.", "Es gelten insbesondere:"],
    bullets: [
      "Zugriffsschutz",
      "rollenbasierte Berechtigungen",
      "Verschlüsselung",
      "Audit-Logs",
      "Sicherheitsprüfungen",
      "Minimalprinzip bei Datenzugriffen",
    ],
  },
  {
    number: 9,
    title: "EU AI Act & Transparenzpflichten",
    paragraphs: [
      "BerufOS kennzeichnet KI-gestützte Funktionen transparent.",
      "Nutzer werden darüber informiert:",
      "BerufOS nutzt keine verbotenen KI-Praktiken gemäß EU AI Act.",
    ],
    bullets: [
      "wann KI verwendet wird",
      "welche Risiken bestehen",
      "welche Entscheidungen menschlich geprüft werden müssen",
    ],
    bulletsAfterIndex: 1,
  },
  {
    number: 10,
    title: "Haftung",
    paragraphs: [
      "BerufOS haftet unbeschränkt:",
      "Im Übrigen ist die Haftung auf den typischerweise vorhersehbaren Schaden begrenzt.",
      "Eine Haftung für KI-generierte Inhalte wird ausgeschlossen, soweit gesetzlich zulässig.",
    ],
    bullets: ["bei Vorsatz", "grober Fahrlässigkeit", "Verletzung von Leben, Körper oder Gesundheit"],
  },
  {
    number: 11,
    title: "Kündigung",
    paragraphs: [
      "Abonnements können zum Ende der jeweiligen Laufzeit gekündigt werden.",
      "Das Recht zur außerordentlichen Kündigung bleibt unberührt.",
    ],
  },
  {
    number: 12,
    title: "Schlussbestimmungen",
    paragraphs: [
      "Es gilt deutsches Recht.",
      "Gerichtsstand ist – soweit zulässig – Karlsruhe.",
      "Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Regelungen unberührt.",
    ],
  },
];
