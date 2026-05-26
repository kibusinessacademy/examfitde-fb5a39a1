/**
 * Premium Content Authority Engine — SSOT.
 *
 * Aggregiert berufsbezogene Hilfestellungen, Rechtslage, Best-Practices,
 * Vorlagen, interaktive Tools, Risiko-Checks und KI-Assistenten in einer
 * konsistenten Topic-Struktur.
 *
 * Brücken (keine Doppel-Strukturen):
 *  - HR Deadline OS (/hr/fristenrechner-kuendigung, /hr/:slug)
 *  - Wissen-Hubs (/wissen/beruf|kompetenz|pruefung/:key)
 *  - Suites (/suites/:slug) als Conversion-Pfad
 */

export type AuthorityAssetKind =
  | "tool"
  | "risk-check"
  | "checklist"
  | "template"
  | "ai-assistant"
  | "legal-hub"
  | "guide";

export interface AuthorityAsset {
  kind: AuthorityAssetKind;
  slug: string;
  title: string;
  description: string;
  href: string;
  /** true wenn die Zielseite bereits live ist (Bridge zu existierender Struktur). */
  live: boolean;
  /** Pflicht-Rechtsgrundlage / Quelle. */
  source?: string;
}

export interface AuthorityTopic {
  slug: string;
  title: string;
  shortTitle: string;
  audience: string[];
  intro: string;
  metaTitle: string;
  metaDescription: string;
  /** Übergeordnete Cluster für interne Verlinkung. */
  cluster: "arbeitsrecht" | "ausbildung" | "compliance" | "operations" | "vertrag";
  assets: AuthorityAsset[];
  faq: { q: string; a: string }[];
  related: string[];
}

const HUB = "/authority";

export const AUTHORITY_TOPICS: AuthorityTopic[] = [
  {
    slug: "kuendigung",
    title: "Kündigung & Fristen",
    shortTitle: "Kündigung",
    audience: ["Personaler", "Geschäftsführer", "Ausbildungsleiter"],
    cluster: "arbeitsrecht",
    intro:
      "Rechtssichere Kündigung — von der Fristberechnung über die Zustellung bis zum Klage-Risiko. Tools, Checklisten und Vorlagen für Arbeitgeber.",
    metaTitle: "Kündigung & Fristen — Tools, Checklisten, Vorlagen | BerufOS Authority",
    metaDescription:
      "Kündigungsfristen nach §622 BGB, Probezeit, Ausbildung, fristlose Kündigung. Rechner, Checklisten, Vorlagen, Risiko-Check und KI-Assistent.",
    assets: [
      {
        kind: "tool",
        slug: "fristenrechner",
        title: "Kündigungsfrist-Rechner",
        description: "§622 BGB · Probezeit · Betriebszugehörigkeit · Ausbildung. Sofortergebnis mit Rechtsgrundlage.",
        href: "/hr/fristenrechner-kuendigung",
        live: true,
        source: "§622 BGB",
      },
      {
        kind: "risk-check",
        slug: "kuendigungsschutz",
        title: "Kündigungsschutz-Risiko-Check",
        description: "5 Fragen, sofortige Einschätzung zu Kündigungsschutzklage-Risiko nach KSchG.",
        href: `${HUB}/risiko-check/kuendigungsschutz`,
        live: true,
        source: "§§1, 4 KSchG",
      },
      {
        kind: "checklist",
        slug: "kuendigung-arbeitgeber",
        title: "Checkliste: Kündigung durch Arbeitgeber",
        description: "12 Schritte — von Anhörung Betriebsrat (§102 BetrVG) bis nachweisbarer Zustellung.",
        href: `${HUB}/checkliste/kuendigung-arbeitgeber`,
        live: true,
        source: "§102 BetrVG · §623 BGB",
      },
      {
        kind: "template",
        slug: "kuendigungsschreiben",
        title: "Vorlage: Kündigungsschreiben (ordentlich)",
        description: "Schriftform §623 BGB · Empfangsbestätigung · Freistellungs- und Urlaubsklausel.",
        href: `${HUB}/vorlage/kuendigungsschreiben`,
        live: true,
        source: "§623 BGB",
      },
      {
        kind: "legal-hub",
        slug: "hr-deadline-os",
        title: "HR Deadline OS · Longtail",
        description: "Spezialfälle: Probezeit, 2J/5J, fristlos §626, Betriebsrat §102, KSchG §4.",
        href: "/hr/kuendigungsfrist-probezeit",
        live: true,
      },
      {
        kind: "ai-assistant",
        slug: "kuendigung-pruefer",
        title: "KI-Assistent: Kündigungs-Prüfer",
        description: "Vertragsdaten eingeben → KI prüft Frist, Form, Sozialauswahl-Risiko, Empfehlung.",
        href: `${HUB}/assistent/kuendigung-pruefer`,
        live: false,
      },
    ],
    faq: [
      {
        q: "Welche Kündigungsfrist gilt nach §622 BGB?",
        a: "Grundfrist 4 Wochen zum 15. oder Monatsende. Für Arbeitgeber Staffelung nach Betriebszugehörigkeit bis zu 7 Monate.",
      },
      {
        q: "Wann greift der allgemeine Kündigungsschutz?",
        a: "Nach §1 KSchG ab >6 Monaten Betriebszugehörigkeit und in Betrieben mit mehr als 10 Vollzeit-Beschäftigten.",
      },
      {
        q: "Was passiert ohne Betriebsrats-Anhörung?",
        a: "Die Kündigung ist nach §102 Abs. 1 Satz 3 BetrVG unwirksam — auch wenn alle anderen Voraussetzungen erfüllt sind.",
      },
    ],
    related: ["ausbildung", "befristung"],
  },
  {
    slug: "ausbildung",
    title: "Ausbildung & BBiG",
    shortTitle: "Ausbildung",
    audience: ["Ausbildungsleiter", "Ausbilder", "Personaler"],
    cluster: "ausbildung",
    intro:
      "Ausbildungsbetrieb-Operations entlang BBiG: Ausbildungsvertrag, Probezeit, Verkürzung, Prüfungsanmeldung, Übernahme.",
    metaTitle: "Ausbildung & BBiG — Pflichten, Vorlagen, Tools | BerufOS Authority",
    metaDescription:
      "Ausbildungsverträge nach BBiG, Probezeit, Verkürzung §8, Prüfungsanmeldung, Übernahme. Checklisten, Vorlagen und Tools.",
    assets: [
      {
        kind: "checklist",
        slug: "ausbildung-onboarding",
        title: "Checkliste: Azubi-Onboarding (BBiG-konform)",
        description: "Vertrag IHK, Berichtsheft, Ausbildungsplan, Arbeitsmittel, Probezeit-Review.",
        href: `${HUB}/checkliste/ausbildung-onboarding`,
        live: true,
        source: "§§10–14 BBiG",
      },
      {
        kind: "template",
        slug: "ausbildungsplan",
        title: "Vorlage: Betrieblicher Ausbildungsplan",
        description: "Lernfeld-Struktur nach Rahmenlehrplan · Quartalsmeilensteine · Beurteilungsraster.",
        href: `${HUB}/vorlage/ausbildungsplan`,
        live: true,
        source: "§14 BBiG",
      },
      {
        kind: "tool",
        slug: "exam-readiness",
        title: "Prüfungsreife-Check (ExamFit)",
        description: "Skill-Heatmap, Recovery-Pfad und Erfolgswahrscheinlichkeit für Azubi-Kohorten.",
        href: "/suites/pruefungsreife",
        live: true,
      },
      {
        kind: "legal-hub",
        slug: "ausbildung-fristen",
        title: "Ausbildung · Fristen & Kündigung",
        description: "Probezeit (§20 BBiG), Kündigung nach Probezeit (§22 BBiG), Übernahme.",
        href: "/hr/kuendigungsfrist-ausbildung",
        live: true,
      },
      {
        kind: "risk-check",
        slug: "ausbildung-abbruch",
        title: "Risiko-Check: Ausbildungsabbruch",
        description: "Frühindikatoren erkennen — Berichtsheft, Fehlzeiten, Beurteilung, Soziales.",
        href: `${HUB}/risiko-check/ausbildung-abbruch`,
        live: true,
      },
      {
        kind: "ai-assistant",
        slug: "ausbildungsplaner",
        title: "KI-Assistent: Ausbildungsplaner",
        description: "Generiert betrieblichen Ausbildungsplan aus Beruf + Lernfeldern + Standort.",
        href: `${HUB}/assistent/ausbildungsplaner`,
        live: false,
      },
    ],
    faq: [
      {
        q: "Wie lange darf die Probezeit dauern?",
        a: "Mindestens 1 Monat, höchstens 4 Monate (§20 BBiG).",
      },
      {
        q: "Wann ist eine Verkürzung möglich?",
        a: "Bei Vorbildung oder besonderen Leistungen — §8 BBiG. Antrag bei der IHK/HWK.",
      },
    ],
    related: ["kuendigung", "arbeitszeit"],
  },
  {
    slug: "arbeitszeit",
    title: "Arbeitszeit & ArbZG",
    shortTitle: "Arbeitszeit",
    audience: ["Personaler", "Betriebsrat", "Geschäftsführer"],
    cluster: "compliance",
    intro:
      "Arbeitszeitgesetz, EuGH-Urteil zur Zeiterfassung, Pausen, Ruhezeiten, Sonntag/Feiertag. Pflicht-Checklisten und Vorlagen.",
    metaTitle: "Arbeitszeit & ArbZG — Pflichten, Zeiterfassung, Pausen | BerufOS Authority",
    metaDescription:
      "Arbeitszeitgesetz, BAG-Urteil zur Pflicht-Zeiterfassung, Pausen, Ruhezeit, Sonntagsarbeit. Checklisten, Vorlagen, Risiko-Check.",
    assets: [
      {
        kind: "checklist",
        slug: "zeiterfassung-pflicht",
        title: "Checkliste: Pflicht-Zeiterfassung (BAG 13.09.2022)",
        description: "Systemwahl, Anpassung Arbeitsverträge, Betriebsrats-Beteiligung, Datenschutz.",
        href: `${HUB}/checkliste/zeiterfassung-pflicht`,
        live: true,
        source: "BAG 1 ABR 22/21 · §3 ArbSchG",
      },
      {
        kind: "template",
        slug: "arbeitszeit-richtlinie",
        title: "Vorlage: Arbeitszeit-Richtlinie",
        description: "Höchstarbeitszeit, Pausen, Ruhezeit, Mehrarbeit, Vertrauensarbeitszeit-Optionen.",
        href: `${HUB}/vorlage/arbeitszeit-richtlinie`,
        live: true,
        source: "§§3–5 ArbZG",
      },
      {
        kind: "risk-check",
        slug: "arbeitszeit-compliance",
        title: "Compliance-Check: Arbeitszeit",
        description: "10 Fragen — Sofortbewertung Bußgeld-Risiko nach §22 ArbZG (bis 30.000 €).",
        href: `${HUB}/risiko-check/arbeitszeit-compliance`,
        live: true,
        source: "§22 ArbZG",
      },
      {
        kind: "ai-assistant",
        slug: "schichtplaner",
        title: "KI-Assistent: Schichtplan-Validator",
        description: "Prüft Schichtpläne auf §3 (8h/10h), §4 (Pausen), §5 (11h Ruhezeit).",
        href: `${HUB}/assistent/schichtplaner`,
        live: false,
      },
    ],
    faq: [
      {
        q: "Müssen wir die Arbeitszeit erfassen?",
        a: "Ja — seit BAG-Urteil 13.09.2022 sind Arbeitgeber zur systematischen Erfassung verpflichtet (§3 ArbSchG i.V.m. EuGH C-55/18).",
      },
    ],
    related: ["compliance-dsgvo", "kuendigung"],
  },
  {
    slug: "compliance-dsgvo",
    title: "DSGVO & HR-Compliance",
    shortTitle: "DSGVO/HR",
    audience: ["Personaler", "Datenschutzbeauftragter", "IT-Leitung"],
    cluster: "compliance",
    intro:
      "Beschäftigtendatenschutz nach §26 BDSG, Bewerber-Daten, Personalakte, AÜG, Whistleblower (HinSchG).",
    metaTitle: "DSGVO & HR-Compliance — Beschäftigtendatenschutz | BerufOS Authority",
    metaDescription:
      "§26 BDSG, Bewerberdaten, Personalakte, HinSchG, AÜG. Checklisten, Vorlagen und Risiko-Check für Personaler.",
    assets: [
      {
        kind: "checklist",
        slug: "bewerberdaten-loeschung",
        title: "Checkliste: Bewerberdaten löschen (§17 DSGVO)",
        description: "6-Monats-Frist, AGG-Aufbewahrung (§15 Abs. 4 AGG), Talent-Pool nur mit Einwilligung.",
        href: `${HUB}/checkliste/bewerberdaten-loeschung`,
        live: true,
        source: "Art. 17 DSGVO · §15 AGG",
      },
      {
        kind: "template",
        slug: "datenschutz-arbeitnehmer",
        title: "Vorlage: Datenschutz-Information für Beschäftigte",
        description: "Art. 13 DSGVO-konforme Information bei Einstellung — Personalakte, IT, Monitoring.",
        href: `${HUB}/vorlage/datenschutz-arbeitnehmer`,
        live: true,
        source: "Art. 13 DSGVO · §26 BDSG",
      },
      {
        kind: "risk-check",
        slug: "hinschg-readiness",
        title: "HinSchG-Readiness-Check",
        description: "Hinweisgeberschutzgesetz: Pflicht für Unternehmen ab 50 Beschäftigten — Status prüfen.",
        href: `${HUB}/risiko-check/hinschg-readiness`,
        live: true,
        source: "§12 HinSchG",
      },
    ],
    faq: [
      {
        q: "Wie lange dürfen Bewerberunterlagen aufbewahrt werden?",
        a: "Bis 6 Monate nach Absage (AGG-Klagefrist §15 Abs. 4 AGG = 2 Monate + Beweisreserve).",
      },
    ],
    related: ["arbeitszeit", "vertrag"],
  },
  {
    slug: "vertrag",
    title: "Arbeits- & Ausbildungsverträge",
    shortTitle: "Verträge",
    audience: ["Personaler", "Geschäftsführer"],
    cluster: "vertrag",
    intro:
      "NachweisG, befristete Verträge (TzBfG), Probezeit, Wettbewerbsverbot, AGB-Kontrolle.",
    metaTitle: "Arbeits- & Ausbildungsverträge — Vorlagen & Risiko-Check | BerufOS Authority",
    metaDescription:
      "NachweisG-Pflichten, Befristung nach TzBfG, Probezeit, Wettbewerbsverbot. Vorlagen, Checklisten und Risiko-Check.",
    assets: [
      {
        kind: "checklist",
        slug: "nachweisg-pflichten",
        title: "Checkliste: NachweisG-Pflichten (seit 01.08.2022)",
        description: "15 Pflicht-Angaben schriftlich am 1. Arbeitstag — sonst Bußgeld bis 2.000 € je Fall.",
        href: `${HUB}/checkliste/nachweisg-pflichten`,
        live: true,
        source: "§2 NachweisG",
      },
      {
        kind: "template",
        slug: "arbeitsvertrag-standard",
        title: "Vorlage: Arbeitsvertrag (unbefristet, NachweisG-konform)",
        description: "Mit Wettbewerbsverbot-Option, Probezeit, Vergütung, Urlaub, Kündigungsfristen-Klausel.",
        href: `${HUB}/vorlage/arbeitsvertrag-standard`,
        live: true,
        source: "§2 NachweisG · §622 BGB",
      },
      {
        kind: "risk-check",
        slug: "befristung-risiko",
        title: "Risiko-Check: Befristung nach TzBfG",
        description: "Sachgrund, Vorbeschäftigung, Höchstdauer — Risiko Entfristungs-Klage.",
        href: `${HUB}/risiko-check/befristung-risiko`,
        live: true,
        source: "§14 TzBfG",
      },
    ],
    faq: [
      {
        q: "Was muss seit Aug 2022 im Arbeitsvertrag stehen?",
        a: "15 Pflicht-Angaben nach §2 NachweisG, u.a. Probezeit, Vergütungs-Bestandteile, Arbeitszeit, Verfahren bei Kündigung.",
      },
    ],
    related: ["kuendigung", "ausbildung"],
  },
];

export function findTopic(slug: string): AuthorityTopic | undefined {
  return AUTHORITY_TOPICS.find((t) => t.slug === slug);
}

export function findAsset(topicSlug: string, assetSlug: string): AuthorityAsset | undefined {
  return findTopic(topicSlug)?.assets.find((a) => a.slug === assetSlug);
}

/** Alle Assets eines bestimmten Typs (für Hub-Sektionen). */
export function allAssetsByKind(kind: AuthorityAssetKind): Array<{ topic: AuthorityTopic; asset: AuthorityAsset }> {
  return AUTHORITY_TOPICS.flatMap((topic) =>
    topic.assets.filter((a) => a.kind === kind).map((asset) => ({ topic, asset })),
  );
}
