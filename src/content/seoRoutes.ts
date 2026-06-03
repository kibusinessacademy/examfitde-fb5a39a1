/**
 * SEO Routes SSOT
 * --------------------------------------------------------------
 * Single source of truth for prerender-Content + Sitemap-Generation.
 *
 * Used by:
 *   - scripts/seo/prerender.mjs       → injects above-the-fold HTML into dist/{path}/index.html
 *   - scripts/seo/build-sitemaps.mjs  → emits dist/sitemaps/{group}.xml
 *   - scripts/seo/validate-prerender.mjs
 *   - React pages (optional: import the same content for hydration parity)
 *
 * Rules:
 *   - path: leading slash, no trailing slash, lowercase
 *   - title: 30-60 chars
 *   - description: 70-160 chars
 *   - intro: ≥600 chars Markdown-light (used for above-the-fold body)
 *   - keyFacts: ≥5 short bullet points (key-value style preferred)
 *   - faq: ≥6 Q&A pairs (used for FAQ JSON-LD + visible FAQ block)
 *   - jsonLd: array of structured-data objects (will be inlined as <script type="application/ld+json">)
 *   - sitemapGroup: routes the URL into the correct sub-sitemap
 *   - status: 'live' (will be prerendered + in sitemap) or 'stub' (skipped until content filled)
 */

export type SitemapGroup = "static" | "products" | "blog" | "content";

export interface FaqEntry {
  q: string;
  a: string;
}

export interface KeyFact {
  label: string;
  value: string;
}

export interface SeoRoute {
  path: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  keyFacts: KeyFact[];
  faq: FaqEntry[];
  /** Optional raw HTML content (already sanitized) injected after intro. Use for hub link lists, etc. */
  contentHtml?: string;
  jsonLd?: Record<string, unknown>[];
  sitemapGroup: SitemapGroup;
  /** 'live' = goes to prerender + sitemap; 'stub' = skipped (content TBD). Defaults to 'live'. */
  status?: "live" | "stub";
  /** ISO date for sitemap lastmod; defaults to today at build time when omitted */
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

const SITE = "https://examfit.de";

// Konsolidiert mit dem EducationalOrganization-Knoten in index.html (#organization)
// via @id-Verlinkung — vermeidet Duplikate und stärkt die Knowledge-Graph-Entität.
const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "ExamFit",
  url: SITE,
  logo: `${SITE}/pwa-512x512.png`,
  sameAs: [
    "https://www.linkedin.com/company/examfit",
  ],
};

function faqJsonLd(faq: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: it.name,
      item: `${SITE}${it.path}`,
    })),
  };
}

// ────────────────────────────────────────────────────────────
// LIVE ROUTES (16 pilots)
// ────────────────────────────────────────────────────────────

const live: SeoRoute[] = [
  // 1. Home
  {
    path: "/",
    title: "ExamFit – KI-Prüfungstraining für IHK & AEVO",
    description:
      "Bestehe IHK-, AEVO-, Bilanzbuchhalter- oder FIAE-Prüfung mit adaptivem Lernplan, prüfungsnahen Simulationen und KI-Tutor mit Quellenangaben.",
    h1: "Bestehe deine Prüfung – mit System statt Glück",
    intro:
      "ExamFit ist ein adaptives Prüfungstrainings-System für IHK-Abschlussprüfungen, Fachwirt-, Meister-, AEVO-, Bilanzbuchhalter- und Fachinformatiker-Prüfungen. Beruf auswählen & Prüfungstraining starten – die Plattform analysiert in einem kostenlosen Selbsttest deine Schwachstellen und erstellt einen 4-Wochen-Lernplan, der Lernkurse, Übungsfragen, Mini-Checks und einen KI-Tutor mit Quellenangaben kombiniert. Am Ende stehen realistische Prüfungssimulationen mit Readiness-Score, der dir eine fundierte Einschätzung deines Vorbereitungsstands gibt. Kein generisches Lernmaterial, sondern passgenaue Vorbereitung auf deine Prüfung – schriftlich, praktisch oder mündliches Fachgespräch. Vertrauen von Auszubildenden, Fortbildungsteilnehmern und Ausbildungsbetrieben in ganz Deutschland. ExamFit unterstützt bei der strukturierten Prüfungsvorbereitung mit prüfungsnahen Aufgabenformaten.",
    contentHtml: `<p><a href="/berufe"><strong>Beruf auswählen & Prüfungstraining starten</strong></a> &middot; <a href="/preise">Preise ab 24,90 €</a> &middot; <a href="/produkte">Komplettpaket ansehen</a></p><p>Trust-Signale: über 200 IHK-Berufe abgedeckt, Strict-RAG KI-Tutor mit Quellen, DSGVO-konform, Hosting in der EU.</p>`,
    keyFacts: [
      { label: "Lernformat", value: "Adaptive Kurse + Simulationen + KI-Tutor" },
      { label: "Abdeckung", value: "IHK, AEVO, Bilanzbuchhalter, FIAE, Fachwirt, Meister" },
      { label: "Selbsttest", value: "Kostenlos, 5 Fragen, Lernplan in 4 Minuten" },
      { label: "Tutor", value: "Strict-RAG mit Quellenangaben – keine Halluzinationen" },
      { label: "Lernplan", value: "4 Wochen, individuell auf Schwächen zugeschnitten" },
      { label: "Sprache", value: "Deutsch" },
    ],
    faq: [
      { q: "Für welche Prüfungen ist ExamFit geeignet?", a: "IHK-Abschlussprüfung Teil 1 + 2, AEVO, Wirtschaftsfachwirt, Bilanzbuchhalter, Fachinformatiker Anwendungsentwicklung, Industriemeister sowie Sachkundeprüfungen wie §34a." },
      { q: "Was kostet ExamFit?", a: "Der Selbsttest und Basis-Lernplan sind kostenlos. Vollzugriff auf Lernkurse und Simulationen ab 19 € pro Monat oder als Einmalkauf je Prüfung." },
      { q: "Wie funktioniert der KI-Tutor?", a: "Der Tutor nutzt Strict-RAG: Antworten basieren ausschließlich auf belegten Quellen aus dem Curriculum. Bei fehlender Quelle gibt er eine klare Refusal-Antwort statt zu raten." },
      { q: "Wie wird der Lernplan erstellt?", a: "Nach dem Selbsttest analysiert ExamFit deine Schwachstellen pro Handlungsfeld und priorisiert die Lerninhalte für die nächsten 4 Wochen automatisch." },
      { q: "Gibt es realistische Prüfungssimulationen?", a: "Ja – mit prüfungsnahen Aufgabenformaten der jeweiligen Prüfung (schriftlich + mündlich), inklusive Zeitlimit und Punkteauswertung. Originalprüfungen der IHK sind urheberrechtlich geschützt; ExamFit bildet Format, Struktur und Anforderungsniveau nach." },
      { q: "Funktioniert ExamFit auch für Betriebe?", a: "Ja, ExamFit bietet Bundles für Ausbildungsbetriebe und Fortbildungsanbieter mit Mitarbeiter-Onboarding und Reporting." },
    ],
    sitemapGroup: "static",
    priority: 1.0,
    changefreq: "daily",
  },

  // 2. Kurse
  {
    path: "/lernkurse",
    title: "Lernkurse – IHK, AEVO, Bilanzbuchhalter, FIAE | ExamFit",
    description:
      "Strukturierte Lernkurse für deine Prüfung: kompakte Lektionen, Mini-Checks, Übungsfragen und KI-Tutor mit Quellen. Kostenlos starten.",
    h1: "Lernkurse für jede Prüfung",
    intro:
      "Die ExamFit-Lernkurse sind in kompakte Lektionen unterteilt, die jeweils ein Handlungsfeld der Prüfung abdecken. Jede Lektion kombiniert Theorie, geprüfte Übungsfragen und einen Mini-Check, der dein Verständnis sofort misst. Schwachstellen fließen automatisch in deinen adaptiven Lernplan. Verfügbare Kurspfade: IHK Teil 1 + 2 (kaufmännisch, gewerblich-technisch), AEVO komplett (schriftlich + praktisch + Fachgespräch), Bilanzbuchhalter (Buchhaltung, Jahresabschluss, Steuern), Fachinformatiker Anwendungsentwicklung (FIAE), Wirtschaftsfachwirt sowie Sachkundeprüfungen. Alle Kurse werden laufend mit IHK-Updates abgeglichen.",
    keyFacts: [
      { label: "Kurspfade", value: "IHK Teil 1 + 2, AEVO, BBh, FIAE, Fachwirt, §34a" },
      { label: "Lektionsformat", value: "Theorie + Übung + Mini-Check" },
      { label: "Anpassung", value: "Adaptiv über Lernplan-Engine" },
      { label: "Updates", value: "Synchron mit IHK-Rahmenstoffplänen" },
      { label: "Tutor", value: "Eingebauter KI-Tutor mit Quellenangaben" },
      { label: "Free-Tier", value: "Mehrere Lektionen pro Kurs frei zugänglich" },
    ],
    faq: [
      { q: "Sind die Lernkurse für eine bestimmte IHK?", a: "Nein – die Inhalte basieren auf den DIHK-Rahmenstoffplänen und gelten bundesweit." },
      { q: "Wie aktuell sind die Inhalte?", a: "Inhalte werden bei jeder DIHK-Aktualisierung des Rahmenstoffplans nachgezogen, in der Regel binnen weniger Wochen." },
      { q: "Kann ich Kurse ohne Abo testen?", a: "Ja, jeder Kurs hat frei zugängliche Lektionen plus den kostenlosen Selbsttest." },
      { q: "Gibt es Mini-Checks zum Mitlernen?", a: "Ja, jede Lektion endet mit einem Mini-Check mit 3-5 Fragen und sofortigem Feedback." },
      { q: "Wie unterscheiden sich die Kurse von YouTube-Videos?", a: "ExamFit-Kurse sind strukturiert nach Handlungsfeldern, mit Übungsfragen verknüpft und an Prüfungssimulationen gekoppelt – kein Konsumieren, sondern Trainieren." },
      { q: "Bekomme ich ein Zertifikat?", a: "Du bekommst ein Lernfortschritts-Zertifikat. Das offizielle Prüfungszeugnis kommt von der IHK." },
    ],
    sitemapGroup: "products",
    priority: 0.9,
    changefreq: "weekly",
  },

  // 2b. Kurskatalog (App-Route /courses)
  {
    path: "/courses",
    title: "Kurskatalog – alle Prüfungstrainings | ExamFit",
    description:
      "Alle ExamFit-Lernkurse im Überblick: IHK Teil 1 + 2, AEVO, Bilanzbuchhalter, FIAE, Fachwirt und Sachkundeprüfungen mit echten Prüfungsfragen und KI-Tutor.",
    h1: "Alle Lernkurse im Überblick",
    intro:
      "Im ExamFit-Kurskatalog findest du alle verfügbaren Prüfungstrainings auf einen Blick: kaufmännische und gewerblich-technische IHK-Abschlussprüfungen (Teil 1 + 2), die komplette AEVO-Vorbereitung (schriftlich, praktisch und Fachgespräch), Bilanzbuchhalter (Buchhaltung, Jahresabschluss, Steuern), Fachinformatiker Anwendungsentwicklung (FIAE), Wirtschaftsfachwirt sowie Sachkundeprüfungen wie §34a. Jeder Kurs ist nach offiziellem DIHK-Rahmenstoffplan strukturiert, kombiniert kompakte Lektionen mit Mini-Checks, prüfungsnahen Übungsfragen und einem KI-Tutor mit Quellenangaben. Mehrere Lektionen pro Kurs sind dauerhaft kostenlos – für den Vollzugriff inklusive Prüfungssimulationen mit Readiness-Score wählst du das passende Komplettpaket. So findest du den richtigen Kurs für deine konkrete Prüfung in unter einer Minute.",
    keyFacts: [
      { label: "Kurspfade", value: "IHK, AEVO, Bilanzbuchhalter, FIAE, Fachwirt, §34a" },
      { label: "Format", value: "Lektionen + Mini-Checks + Übungsfragen + KI-Tutor" },
      { label: "Preise", value: "Free-Tier kostenlos, Komplettpakets ab 19 €" },
      { label: "Updates", value: "Synchron mit DIHK-Rahmenstoffplänen" },
      { label: "Simulationen", value: "Prüfungsnahe Tests mit Readiness-Score" },
      { label: "Sprache", value: "Deutsch" },
    ],
    faq: [
      { q: "Welche Kurse bietet ExamFit?", a: "IHK Teil 1 + 2 (kaufmännisch, gewerblich-technisch), AEVO, Bilanzbuchhalter, Fachinformatiker Anwendungsentwicklung, Wirtschaftsfachwirt, Industriemeister sowie Sachkundeprüfungen wie §34a." },
      { q: "Welcher Kurs passt zu meiner Prüfung?", a: "Wähle deinen Beruf bzw. deine Fortbildung im Katalog – jeder Kurs zeigt Inhalte, Handlungsfelder und Prüfungsformate transparent an, sodass du den passenden Kurs in unter einer Minute findest." },
      { q: "Sind die Kurse für eine bestimmte IHK?", a: "Nein. Die Inhalte basieren auf den DIHK-Rahmenstoffplänen und gelten bundesweit für alle Industrie- und Handelskammern." },
      { q: "Kann ich Kurse kostenlos testen?", a: "Ja, jeder Kurs hat dauerhaft kostenlose Lektionen plus den kostenlosen Selbsttest mit Lernplan-Empfehlung." },
      { q: "Was kostet der Vollzugriff?", a: "Komplettpakets starten ab 19 € pro Prüfung, oft als Einmalkauf ohne Abo." },
      { q: "Wie aktuell sind die Inhalte?", a: "Inhalte werden bei jeder DIHK-Aktualisierung des Rahmenstoffplans nachgezogen, in der Regel binnen weniger Wochen." },
    ],
    sitemapGroup: "products",
    priority: 0.9,
    changefreq: "weekly",
  },
  {
    path: "/blog",
    title: "Blog – Prüfungstipps, IHK-Updates, Lernstrategien | ExamFit",
    description:
      "Aktuelle Beiträge zu IHK-Prüfungen, AEVO, Bilanzbuchhalter, FIAE: Lernstrategien, Prüfungstipps, neue Rahmenstoffpläne und Erfahrungsberichte.",
    h1: "Blog: Prüfungstipps & IHK-Updates",
    intro:
      "Der ExamFit-Blog liefert konkrete Lernstrategien, Updates zu IHK-Rahmenstoffplänen, Erfahrungsberichte von Prüflingen und Hintergründe zu didaktischen Methoden der Prüfungsvorbereitung. Themenschwerpunkte sind die schriftliche und mündliche IHK-Abschlussprüfung, AEVO-Vorbereitung, Bilanzbuchhalter und Fachinformatiker Anwendungsentwicklung. Jeder Beitrag enthält praxisnahe Beispiele, Checklisten zum Mitnehmen und Verweise auf passende Lernkurse oder Selbsttests in der Plattform. Beiträge werden redaktionell von Fachautoren mit IHK-Hintergrund kuratiert und mit Quellenangaben (DIHK, BIBB, BBiG) versehen, damit Aussagen belegbar bleiben.",
    keyFacts: [
      { label: "Frequenz", value: "Mehrere Beiträge pro Woche" },
      { label: "Themen", value: "Lernstrategien, Prüfungsformate, Rahmenstoffpläne" },
      { label: "Autoren", value: "Redaktion + Fachexperten mit IHK-Praxis" },
      { label: "Format", value: "Long-form mit Checklisten und Beispielen" },
      { label: "Zielgruppe", value: "Auszubildende, Fortbildungsteilnehmer, Ausbilder" },
    ],
    faq: [
      { q: "Wie oft erscheinen neue Artikel?", a: "Mehrere Beiträge pro Woche, je nach Aktualität von IHK-Updates." },
      { q: "Sind die Inhalte kostenlos?", a: "Ja, alle Blog-Artikel sind frei zugänglich." },
      { q: "Kann ich den Blog abonnieren?", a: "Über den Newsletter (Anmeldung im Footer) bekommst du wöchentliche Highlights." },
      { q: "Wer schreibt die Artikel?", a: "Eine Redaktion mit IHK-Prüfern, Ausbildern und Fachjournalisten." },
      { q: "Werden Originalquellen verlinkt?", a: "Ja, jeder fachliche Beitrag enthält Quellenangaben (DIHK, BIBB, Berufsbildungsgesetz)." },
    ],
    sitemapGroup: "blog",
    priority: 0.7,
    changefreq: "daily",
  },

  // 4. FAQ
  {
    path: "/faq",
    title: "FAQ – Häufige Fragen zu ExamFit & IHK-Prüfung",
    description:
      "Antworten auf die häufigsten Fragen zu ExamFit, IHK-Prüfungen, Lernkursen, Lernplänen, Tarifen und dem KI-Tutor.",
    h1: "Häufig gestellte Fragen",
    intro:
      "Hier findest du Antworten auf die häufigsten Fragen zur Plattform, zu IHK-Prüfungen und zur Funktionsweise des adaptiven Lernsystems. Die FAQ ist gegliedert in: Plattform und Tarife, Prüfungsorganisation, Lernmethodik, KI-Tutor sowie Datenschutz und Hosting. Für Auszubildende beantworten wir Fragen zum Selbsttest, Lernplan, Mini-Checks und zur mündlichen Prüfungssimulation. Für Betriebe und Bildungsträger erklären wir Reporting-Möglichkeiten, Bulk-Onboarding, AVV nach Art. 28 DSGVO und individuelle Konditionen. Sollte deine Frage hier nicht beantwortet sein, erreichst du den Support unter info@examfit.de und in der Regel werktags innerhalb von 24 Stunden eine Antwort.",
    keyFacts: [
      { label: "Themenbereiche", value: "Plattform, Prüfung, Lernmethodik, KI, Datenschutz" },
      { label: "Support", value: "info@examfit.de" },
      { label: "Antwortzeit", value: "Werktags innerhalb 24 Stunden" },
      { label: "Sprachen", value: "Deutsch" },
      { label: "Wissensbasis", value: "Umfangreiche Wissensbasis" },
    ],
    faq: [
      { q: "Wie starte ich mit ExamFit?", a: "Mache den kostenlosen Selbsttest – danach erhältst du einen 4-Wochen-Lernplan." },
      { q: "Was kostet die Plattform?", a: "Selbsttest und Basis-Lernplan sind kostenlos. Vollzugriff ab 19 € / Monat oder als Einmalkauf je Prüfung." },
      { q: "Kann ich monatlich kündigen?", a: "Ja, monatliche Abos sind jederzeit zum Monatsende kündbar." },
      { q: "Funktioniert der KI-Tutor offline?", a: "Nein, der KI-Tutor benötigt eine Internetverbindung." },
      { q: "Bekomme ich eine Rechnung?", a: "Ja, jede Bestellung erzeugt automatisch eine Rechnung mit ausgewiesener Umsatzsteuer (sofern umsatzsteuerlich anwendbar)." },
      { q: "Wo werden meine Daten gespeichert?", a: "Auf EU-Servern (Frankfurt). Details in der Datenschutzerklärung." },
    ],
    sitemapGroup: "static",
    priority: 0.6,
    changefreq: "monthly",
  },

  // 5. Pruefungstraining Azubis
  {
    path: "/pruefungstraining-azubis",
    title: "Prüfungstraining für Azubis – IHK Teil 1 & 2 | ExamFit",
    description:
      "Adaptives Prüfungstraining für Auszubildende: IHK Teil 1 und 2, mündliche Prüfung, Lernplan und Übungsfragen aus dem realen Prüfungsformat.",
    h1: "Prüfungstraining für Azubis",
    intro:
      "Das ExamFit-Prüfungstraining für Auszubildende deckt IHK-Abschlussprüfung Teil 1 und Teil 2 vollständig ab – in allen kaufmännischen, gewerblich-technischen und IT-Berufen. Das System startet mit einem kostenlosen 5-Fragen-Selbsttest, identifiziert deine Schwachstellen pro Handlungsfeld und baut einen 4-Wochen-Lernplan, der Lernkurse, Übungsfragen und Simulationen kombiniert. Die mündliche Prüfung wird mit einem KI-gestützten Fachgesprächs-Trainer geübt, der Folgefragen stellt und dein Antwortverhalten bewertet. Realistisches Üben statt Frontalunterricht.",
    keyFacts: [
      { label: "Abdeckung", value: "IHK Teil 1 + 2, alle Berufsbilder mit DIHK-Stoffplan" },
      { label: "Schriftlich", value: "Multiple-Choice + offene Fragen + Rechenaufgaben" },
      { label: "Mündlich", value: "Fachgesprächs-Simulator mit Folgefragen" },
      { label: "Lernplan", value: "4 Wochen, adaptiv pro Handlungsfeld" },
      { label: "Free-Tier", value: "Selbsttest und Basis-Lernplan kostenlos" },
      { label: "Mobile", value: "Im Browser nutzbar – Desktop und Smartphone" },
    ],
    faq: [
      { q: "Für welche Ausbildungsberufe ist das Training?", a: "Für alle dualen Ausbildungsberufe mit DIHK-Rahmenstoffplan – kaufmännisch, gewerblich-technisch und IT." },
      { q: "Wie nah ist die Simulation an der echten Prüfung?", a: "Die Aufgabentypen, Punkteverteilung und Zeitvorgaben entsprechen den Vorgaben der DIHK." },
      { q: "Kann ich Teil 1 separat üben?", a: "Ja, beide Prüfungsteile haben eigene Lernpfade und Simulationen." },
      { q: "Wie übe ich die mündliche Prüfung?", a: "Im Fachgesprächs-Simulator stellt der KI-Tutor Fragen und Folgefragen aus deinem Berufsbild und gibt strukturiertes Feedback." },
      { q: "Brauche ich einen Account?", a: "Für den Selbsttest nicht. Für Lernplan und Fortschritts-Tracking ja." },
      { q: "Was kostet das Training?", a: "Selbsttest kostenlos; Vollzugriff ab 19 € pro Monat oder Einmalkauf pro Prüfung." },
    ],
    sitemapGroup: "static",
    priority: 0.9,
    changefreq: "weekly",
  },

  // 6. Pruefungstraining Betriebe
  {
    path: "/pruefungstraining-betriebe",
    title: "Prüfungstraining für Betriebe – IHK Azubis | ExamFit",
    description:
      "ExamFit für Ausbildungsbetriebe: einheitliches Prüfungstraining für alle Azubis, Reporting, Lernfortschritt pro Lehrjahr, faire Preise pro Sitz.",
    h1: "Prüfungstraining für Ausbildungsbetriebe",
    intro:
      "ExamFit unterstützt Ausbildungsbetriebe dabei, ihre Auszubildenden strukturiert auf die IHK-Abschlussprüfung vorzubereiten. Das Betriebs-Bundle gibt jedem Azubi einen Sitzplatz, einheitliche Lernkurse und persönliche Lernpläne, während der Ausbilder im Reporting den Lernfortschritt pro Lehrjahr und Handlungsfeld sieht. So erkennst du frühzeitig, welche Azubis Risiken zeigen und in welchen Bereichen Schulungsbedarf besteht. Onboarding erfolgt über Bulk-Invite per E-Mail, alle Azubis können nach Annahme der Einladung sofort loslegen. Inhalte sind synchron mit dem DIHK-Rahmenstoffplan, das Hosting erfolgt DSGVO-konform in Frankfurt.",
    keyFacts: [
      { label: "Lizenzmodell", value: "Pro Sitz, monatlich oder jährlich" },
      { label: "Reporting", value: "Lernfortschritt pro Azubi & Handlungsfeld" },
      { label: "Onboarding", value: "Bulk-Invite per E-Mail" },
      { label: "Updates", value: "Inhalte synchron mit DIHK-Rahmenstoffplan" },
      { label: "Datenschutz", value: "DSGVO, EU-Hosting (Frankfurt)" },
      { label: "Support", value: "Persönlicher Ansprechpartner für größere Bundles" },
    ],
    faq: [
      { q: "Wie viele Sitzplätze sind Minimum?", a: "Bundles starten ab 5 Sitzen. Größere Bundles auf Anfrage." },
      { q: "Wie funktioniert die Abrechnung?", a: "Monatlich oder jährlich pro Sitz. Rechnungen werden automatisch ausgestellt." },
      { q: "Sehen wir, wie weit Azubis sind?", a: "Ja, im Betriebs-Cockpit pro Azubi und pro Handlungsfeld – ohne einzelne Antworten einzusehen." },
      { q: "Können Azubis ihre Daten mitnehmen?", a: "Ja, der Lernfortschritt gehört dem Azubi und kann nach Ausscheiden in einen privaten Account migriert werden." },
      { q: "Gibt es eine Pilotphase?", a: "Ja, ein Test mit voller Funktionalität für eine begrenzte Anzahl Sitze – Details auf Anfrage." },
      { q: "Welche Ausbildungsberufe werden abgedeckt?", a: "Alle dualen IHK-Berufe mit DIHK-Rahmenstoffplan." },
    ],
    sitemapGroup: "static",
    priority: 0.85,
    changefreq: "weekly",
  },

  // 7. Pruefungstraining Institutionen
  {
    path: "/pruefungstraining-institutionen",
    title: "Prüfungstraining für Bildungsträger | ExamFit",
    description:
      "ExamFit für Berufsschulen, Bildungsträger und Kammern: Lehrer-Cockpit, Klassenverwaltung, Lernfortschritt pro Schüler, faire Volumen-Preise.",
    h1: "Prüfungstraining für Bildungsträger & Berufsschulen",
    intro:
      "ExamFit liefert Berufsschulen, Bildungsträgern und Kammern ein einheitliches digitales Prüfungstraining. Lehrer organisieren Klassen im Cockpit, weisen Lernpfade zu und sehen den Lernfortschritt pro Schüler – ohne in einzelne Antworten Einsicht zu nehmen (datenschutzkonform). Schüler bekommen adaptive Lernpläne und prüfungsnahe Simulationen. Für größere Institutionen werden Themen wie Single-Sign-On, Schnittstellen und individuelle Reporting-Exporte projektbezogen abgestimmt – kontaktiere uns für eine Bedarfsabstimmung. Hosting erfolgt DSGVO-konform in Frankfurt, ein Auftragsverarbeitungsvertrag (AVV) nach Art. 28 DSGVO wird bereitgestellt.",
    keyFacts: [
      { label: "Lizenzmodell", value: "Pro Lernplatz, Volumenkonditionen auf Anfrage" },
      { label: "Klassen", value: "Lehrer-Cockpit mit Klassen, Lernpfaden, Reports" },
      { label: "Datenschutz", value: "DSGVO, EU-Hosting (Frankfurt), AVV verfügbar" },
      { label: "Onboarding", value: "Bulk-Import per CSV" },
      { label: "Enterprise-Themen", value: "SSO, Schnittstellen, Exporte – auf Anfrage" },
      { label: "Support", value: "Persönlicher Ansprechpartner für Institutionen" },
    ],
    faq: [
      { q: "Bietet ihr Single-Sign-On an?", a: "SSO-Integrationen werden projektbezogen mit Institutionen abgestimmt. Sprich uns auf deinen konkreten Bedarf an." },
      { q: "Können wir eigene Inhalte einspielen?", a: "Eigene Inhalte und LTI-Anbindungen werden projektbezogen geprüft – kontaktiere uns für deinen Use-Case." },
      { q: "Wie sieht es mit Datenschutz aus?", a: "DSGVO-konform, EU-Hosting (Frankfurt), AVV nach Art. 28 DSGVO wird bereitgestellt." },
      { q: "Wie viele Sitze sind möglich?", a: "Bundles skalieren je nach Bedarf. Größere Volumina werden individuell abgestimmt." },
      { q: "Können wir Reports exportieren?", a: "Reports stehen im Lehrer-Cockpit zur Verfügung; Export-Formate werden je nach Paket abgestimmt." },
      { q: "Gibt es einen Demo-Termin?", a: "Ja, über das Kontaktformular kannst du eine Demo buchen." },
    ],
    sitemapGroup: "static",
    priority: 0.8,
    changefreq: "weekly",
  },

  // 8. Preise
  {
    path: "/preise",
    title: "Preise – ExamFit Tarife im Überblick",
    description:
      "Transparente Preise: kostenloser Selbsttest, B2C Komplettpaket 24,90 € einmalig pro Prüfung, Betriebs-Bundles pro Sitz, Bildungsträger-Konditionen auf Anfrage.",
    h1: "ExamFit-Preise",
    intro:
      "ExamFit bietet drei Tarif-Segmente: (1) Privat – das B2C-Komplettpaket für eine Prüfung kostet einmalig 24,90 € (12 Monate Vollzugriff, kein Abo, monatliche Lerntarife ab 19 €/Monat alternativ verfügbar), (2) Betriebs-Bundles pro Sitz für Ausbildungsbetriebe inklusive Lernfortschritts-Reporting auf Handlungsfeld-Ebene, (3) Institutions-Konditionen mit individueller Abstimmung für Berufsschulen, Bildungsträger und Kammern. Alle Preise verstehen sich zzgl. Umsatzsteuer (sofern umsatzsteuerlich anwendbar), Rechnungen werden automatisch erzeugt und per E-Mail zugestellt. Der Selbsttest und der Basis-Lernplan sind dauerhaft kostenlos und ohne Zahlungsdaten nutzbar; ein Upgrade auf den Vollzugriff ist jederzeit möglich.",
    contentHtml: `<p><strong>B2C Komplettpaket: 24,90 € einmalig</strong> – 12 Monate Vollzugriff auf eine Prüfung. <a href="/berufe">Jetzt Beruf wählen & kaufen</a>.</p>`,
    keyFacts: [
      { label: "Free", value: "Selbsttest + Basis-Lernplan – dauerhaft kostenlos" },
      { label: "Komplettpaket B2C", value: "24,90 € einmalig pro Prüfung, 12 Monate" },
      { label: "Privat (Abo)", value: "Ab 19 € / Monat, monatlich kündbar" },
      { label: "Betriebe", value: "Pro Sitz, ab 5 Sitzen, mit Reporting" },
      { label: "Institutionen", value: "Konditionen auf Anfrage" },
      { label: "Zahlung", value: "SEPA, Kreditkarte, Rechnung" },
    ],
    faq: [
      { q: "Gibt es eine kostenlose Variante?", a: "Ja, Selbsttest und Basis-Lernplan sind dauerhaft kostenlos." },
      { q: "Kann ich monatlich kündigen?", a: "Ja, monatliche Tarife sind jederzeit zum Monatsende kündbar." },
      { q: "Was kostet ein Betriebs-Sitz?", a: "Abhängig von Volumen, ab ca. 12 € pro Sitz pro Monat. Detailpreise auf Anfrage." },
      { q: "Bekomme ich eine Rechnung?", a: "Ja, jede Bestellung erzeugt automatisch eine Rechnung mit ausgewiesener Umsatzsteuer (sofern umsatzsteuerlich anwendbar)." },
      { q: "Was ist im Einmalkauf enthalten?", a: "12 Monate Vollzugriff auf eine spezifische Prüfung inkl. KI-Tutor und Simulationen." },
      { q: "Gibt es Bildungsrabatte?", a: "Ja, für anerkannte Bildungseinrichtungen und gemeinnützige Träger." },
    ],
    sitemapGroup: "static",
    priority: 0.85,
    changefreq: "monthly",
  },

  // 9-12: Bilanzbuchhalter Cluster (4 Pages)
  {
    path: "/bilanzbuchhalter-pruefungsvorbereitung",
    title: "Bilanzbuchhalter Prüfungsvorbereitung | ExamFit",
    description:
      "Strukturierte Online-Vorbereitung für die IHK-Bilanzbuchhalter-Prüfung: Lernplan, Übungsklausuren, KI-Tutor mit Quellen, alle Handlungsbereiche.",
    h1: "Bilanzbuchhalter Prüfungsvorbereitung",
    intro:
      "Die ExamFit-Vorbereitung auf die geprüfte Bilanzbuchhalter-Prüfung deckt alle drei schriftlichen Handlungsbereiche ab: Geschäftsvorfälle erfassen und Jahresabschlüsse erstellen, Jahresabschlüsse analysieren und auswerten, Steuerrecht. Hinzu kommt die mündliche Prüfung (Situationsaufgabe + Fachgespräch). Adaptive Lernpläne priorisieren deine schwächsten Bereiche, Übungsklausuren bilden das Prüfungsformat ab und der KI-Tutor beantwortet Fragen mit belegten Quellen aus dem Curriculum. Inhalte sind synchron mit der DIHK-Rechtsverordnung.",
    keyFacts: [
      { label: "Handlungsbereiche", value: "Buchhaltung, Jahresabschluss, Steuern" },
      { label: "Mündliche Prüfung", value: "Situationsaufgabe + Fachgespräch im Simulator" },
      { label: "Übungsklausuren", value: "Punkteauswertung am DIHK-Anforderungsniveau orientiert" },
      { label: "Tutor", value: "Strict-RAG mit Quellenangaben aus HGB/EStG" },
      { label: "Lernplan", value: "Adaptiv über 12-16 Wochen" },
      { label: "Inhalte", value: "Synchron mit DIHK-Rechtsverordnung" },
    ],
    faq: [
      { q: "Welche Handlungsbereiche werden abgedeckt?", a: "Alle drei schriftlichen Handlungsbereiche plus die mündliche Prüfung (Situationsaufgabe + Fachgespräch)." },
      { q: "Wie lange dauert die Vorbereitung?", a: "Empfohlen werden 12-16 Wochen, der adaptive Lernplan stellt sich auf dein Tempo ein." },
      { q: "Sind die Aufgaben aktuell?", a: "Ja, Inhalte werden mit der DIHK-Rechtsverordnung und IDW-Standards aktuell gehalten." },
      { q: "Welche Vorkenntnisse brauche ich?", a: "Empfohlen: Ausbildung zum Steuerfachangestellten oder vergleichbare Buchhaltungspraxis." },
      { q: "Kann ich nur einen Bereich üben?", a: "Ja, jeder Handlungsbereich hat eigene Module und Simulationen." },
      { q: "Wie übe ich die mündliche Prüfung?", a: "Im Simulator stellt der KI-Tutor Situationsaufgaben und Folgefragen mit strukturiertem Feedback." },
    ],
    sitemapGroup: "content",
    priority: 0.85,
    changefreq: "weekly",
  },
  {
    path: "/bilanzbuchhalter-buchhaltung",
    title: "Bilanzbuchhalter: Buchhaltung – Handlungsbereich 1 | ExamFit",
    description:
      "Kompakte Online-Vorbereitung für Handlungsbereich 1 der Bilanzbuchhalter-Prüfung: Geschäftsvorfälle, laufende Buchhaltung, Lernplan + Übungen.",
    h1: "Bilanzbuchhalter: Buchhaltung",
    intro:
      "Handlungsbereich 1 der Bilanzbuchhalter-Prüfung deckt die laufende Buchführung umfassend ab: Geschäftsvorfälle erfassen und kontieren, Anlagenbuchhaltung mit planmäßiger und außerplanmäßiger Abschreibung, Personalbuchhaltung inklusive Lohnsteuer und Sozialversicherung, Umsatzsteuer-Voranmeldung sowie Kostenrechnungs-Grundlagen. ExamFit liefert hierfür einen strukturierten Lernpfad mit Übungsbuchungen, Kontierungs-Trainer und praxisnahen Fallstudien aus typischen KMU-Konstellationen. Der KI-Tutor erklärt Buchungssätze mit Verweis auf HGB-Paragraphen und gibt prüfungsnahe Erläuterungen zur Kontensystematik. Realistische Simulationen orientieren sich an Format und Anforderungsniveau der DIHK-Klausur und werden mit automatischer Punkteauswertung ausgewertet.",
    keyFacts: [
      { label: "Themen", value: "Kontierung, Anlagenbuchhaltung, Personal, USt" },
      { label: "Trainer", value: "Kontierungs-Trainer mit umfangreichem Fallpool" },
      { label: "Fallstudien", value: "Praxisnahe Geschäftsvorfälle aus KMU" },
      { label: "Tutor", value: "Erklärt Buchungssätze mit HGB-Bezug" },
      { label: "Klausurformat", value: "An DIHK-Aufgabenstil orientiert" },
    ],
    faq: [
      { q: "Wie viele Übungsbuchungen sind enthalten?", a: "Umfangreicher Pool kontierter Geschäftsvorfälle aus typischen KMU-Konstellationen." },
      { q: "Werden auch internationale Standards behandelt?", a: "Schwerpunkt ist HGB; IFRS wird in Handlungsbereich 2 vertiefend behandelt." },
      { q: "Ist die Anlagenbuchhaltung enthalten?", a: "Ja, inklusive Abschreibungsmethoden und außerplanmäßiger Abschreibung." },
      { q: "Wie lange dauert dieser Bereich?", a: "Empfohlen 4-6 Wochen, abhängig von Vorkenntnissen." },
      { q: "Gibt es Probeklausuren?", a: "Ja, drei Probeklausuren im prüfungsnahen Format mit automatischer Auswertung." },
      { q: "Kann ich nur Buchhaltung kaufen?", a: "Ja, jeder Handlungsbereich ist einzeln buchbar." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },
  {
    path: "/bilanzbuchhalter-jahresabschluss",
    title: "Bilanzbuchhalter: Jahresabschluss (HB 2) | ExamFit",
    description:
      "Handlungsbereich 2 der Bilanzbuchhalter-Prüfung: Jahresabschluss erstellen und auswerten, Bilanzanalyse, IFRS-Grundlagen, Übungen + Klausuren.",
    h1: "Bilanzbuchhalter: Jahresabschluss",
    intro:
      "Handlungsbereich 2 fokussiert auf die Erstellung und Auswertung von Jahresabschlüssen nach HGB sowie Grundlagen der internationalen Rechnungslegung (IFRS) auf Niveau der DIHK-Prüfungsanforderung. Inhaltlich enthalten sind: Bilanzpolitik, Bewertungsmethoden für Vermögen und Schulden, Anhang und Lagebericht mit Pflichtangaben nach §§ 284-289 HGB, Kapitalflussrechnung in direkter und indirekter Methode sowie Bilanzanalyse mit Liquiditäts-, Rentabilitäts- und Vermögensanalyse-Kennzahlen. Hinzu kommt ein vergleichender Überblick HGB versus IFRS für die wichtigsten Bewertungsunterschiede. ExamFit liefert vollständige Übungs-Jahresabschlüsse mit ausführlichem Lösungsweg und einen Bilanzanalyse-Trainer mit den prüfungsrelevanten betriebswirtschaftlichen Kennzahlen.",
    keyFacts: [
      { label: "Themen", value: "HGB-Jahresabschluss, IFRS-Grundlagen, Bilanzanalyse" },
      { label: "Übungen", value: "Vollständige Jahresabschlüsse mit Lösungsweg" },
      { label: "Kennzahlen", value: "Trainer mit den prüfungsrelevanten BWL-Kennzahlen" },
      { label: "IFRS", value: "Vergleichender Überblick HGB/IFRS" },
      { label: "Klausuren", value: "Drei Probeklausuren im prüfungsnahen DIHK-Format" },
    ],
    faq: [
      { q: "Wie tief geht IFRS?", a: "Auf Niveau der DIHK-Prüfungsanforderung – Vergleich HGB/IFRS, keine Vollzertifizierung." },
      { q: "Welche Kennzahlen werden behandelt?", a: "Die prüfungsrelevanten Kennzahlen aus Liquiditäts-, Rentabilitäts- und Vermögensanalyse." },
      { q: "Sind Anhang und Lagebericht enthalten?", a: "Ja, mit Pflichtangaben nach §§ 284-289 HGB." },
      { q: "Wie übe ich die Kapitalflussrechnung?", a: "Im Trainer mit direkter und indirekter Methode, jeweils mit Beispielfällen." },
      { q: "Reicht das für die mittlere Schwierigkeit der Klausur?", a: "Ja, der Inhalt deckt das DIHK-Anforderungsniveau vollständig ab." },
      { q: "Gibt es Originalklausuren?", a: "Originalprüfungen sind urheberrechtlich geschützt. Wir bieten Klausuren im identischen Format und Anforderungsniveau." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },
  {
    path: "/bilanzbuchhalter-steuern",
    title: "Bilanzbuchhalter: Steuern – Handlungsbereich 3 | ExamFit",
    description:
      "Handlungsbereich 3 der Bilanzbuchhalter-Prüfung: Steuerrecht (USt, ESt, KSt, GewSt), Übungsfälle und Klausuren mit aktueller Rechtsprechung.",
    h1: "Bilanzbuchhalter: Steuern",
    intro:
      "Handlungsbereich 3 deckt das prüfungsrelevante Steuerrecht für die Bilanzbuchhalter-Prüfung ab: Umsatzsteuer mit Tatbeständen, Steuersätzen und Sonderfällen wie innergemeinschaftlichen Leistungen und Reverse-Charge, Einkommensteuer mit allen sieben Einkunftsarten, Sonderausgaben und außergewöhnlichen Belastungen, Körperschaftsteuer mit Schachtelprivileg und verdeckter Gewinnausschüttung sowie Gewerbesteuer mit Hinzurechnungen und Kürzungen. ExamFit liefert einen wachsenden Pool steuerlicher Fallstudien aus typischen Steuerberater-Praxis und IHK-Klausuren, einen Steuer-Trainer mit aktueller Rechtsprechung und einen KI-Tutor, der Antworten mit EStG-, UStG- und KStG-Paragraphen belegt. Inhalte werden bei jeder relevanten Gesetzesänderung wie dem Jahressteuergesetz aktualisiert.",
    keyFacts: [
      { label: "Themen", value: "USt, ESt, KSt, GewSt – prüfungsrelevant" },
      { label: "Fallstudien", value: "Wachsender Pool steuerlicher Praxisfälle" },
      { label: "Aktualität", value: "Synchron mit Gesetzesänderungen" },
      { label: "Tutor", value: "Antworten mit EStG/UStG/KStG-Bezug" },
      { label: "Probeklausuren", value: "Im prüfungsnahen DIHK-Format" },
    ],
    faq: [
      { q: "Welche Steuerarten werden behandelt?", a: "USt, ESt, KSt und GewSt im prüfungsrelevanten Umfang." },
      { q: "Wie aktuell ist das Steuerrecht?", a: "Inhalte werden bei jeder relevanten Gesetzesänderung (z. B. Jahressteuergesetz) aktualisiert." },
      { q: "Werden auch Doppelbesteuerungsabkommen behandelt?", a: "Grundlagen ja, Vertiefung ist nicht prüfungsrelevant." },
      { q: "Gibt es einen Umsatzsteuer-Trainer?", a: "Ja, mit Sonderfällen wie innergemeinschaftlichen Leistungen und Reverse-Charge." },
      { q: "Wie übe ich Einkommensteuer?", a: "Mit zahlreichen Fallstudien aus den sieben Einkunftsarten und der Veranlagungspraxis." },
      { q: "Sind die Fälle aus der Praxis?", a: "Ja, basierend auf typischen Konstellationen aus Steuerberaterkanzleien und IHK-Klausuren." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },

  // 13-16: FIAE Cluster (4 Pages)
  {
    path: "/fiae-pruefungsvorbereitung",
    title: "FIAE Prüfungsvorbereitung – Fachinformatiker AE | ExamFit",
    description:
      "Vorbereitung auf die IHK-Prüfung Fachinformatiker Anwendungsentwicklung: Lernplan, Programmierübungen, WiSo, Projektarbeit + KI-Tutor mit Quellen.",
    h1: "FIAE Prüfungsvorbereitung",
    intro:
      "ExamFit bereitet auf die Abschlussprüfung Fachinformatiker Anwendungsentwicklung (FIAE) Teil 1 (gestreckte Abschlussprüfung) und Teil 2 (Projektarbeit + Klausur) umfassend vor. Inhaltlich abgedeckt: Anwendungsentwicklung mit Datenmodellierung (ER-Diagramme, Normalisierung), objektorientierter Programmierung, Algorithmen und Datenstrukturen, Software-Test sowie SQL; Wirtschafts- und Sozialkunde (WiSo) als eigener Lernpfad; betriebliche Projektarbeit mit Vorlagen für Projektantrag, Dokumentation, Präsentation und Fachgespräch. Adaptive Lernpläne priorisieren deine schwächsten Bereiche pro Handlungsfeld, Programmierübungen werden direkt im Browser ausgeführt mit automatischer Auswertung, und der KI-Tutor erklärt Code-Beispiele mit Quellenangaben aus dem Curriculum.",
    keyFacts: [
      { label: "Prüfungsteile", value: "Teil 1 (gestreckt) + Teil 2 (Projekt + Klausur)" },
      { label: "Anwendungsentwicklung", value: "Datenmodellierung, OOP, Algorithmen, Testen" },
      { label: "WiSo", value: "Eigener Lernpfad mit Übungsfragen" },
      { label: "Projektarbeit", value: "Vorlagen für Antrag, Doku, Präsentation, Fachgespräch" },
      { label: "Programmierung", value: "In-Browser-Übungen mit automatischer Auswertung" },
    ],
    faq: [
      { q: "Welche Programmiersprachen werden behandelt?", a: "Schwerpunkt ist sprachunabhängige Algorithmik, Beispiele in Java, C# und Python." },
      { q: "Hilft ExamFit bei der Projektarbeit?", a: "Ja, mit Vorlagen für Projektantrag, Dokumentation, Präsentation und Fachgesprächs-Simulation." },
      { q: "Ist WiSo separat enthalten?", a: "Ja, mit eigenem Lernpfad und Übungsklausur." },
      { q: "Wie aktuell sind die Inhalte?", a: "Synchron mit der DIHK-Verordnung über die Berufsausbildung in der Informationstechnik." },
      { q: "Kann ich Code im Browser üben?", a: "Ja, In-Browser-Übungen für Algorithmik und SQL mit automatischer Auswertung." },
      { q: "Wird AP1 abgedeckt?", a: "Ja, gestreckte Abschlussprüfung Teil 1 ist Bestandteil des Lernpfads." },
    ],
    sitemapGroup: "content",
    priority: 0.85,
    changefreq: "weekly",
  },
  {
    path: "/fiae-anwendungsentwicklung",
    title: "FIAE: Anwendungsentwicklung – Schwerpunkt | ExamFit",
    description:
      "Schwerpunkt Anwendungsentwicklung der FIAE-Prüfung: Datenmodellierung, OOP, Algorithmen, Software-Test, SQL – mit Übungen und KI-Tutor.",
    h1: "FIAE: Anwendungsentwicklung",
    intro:
      "Der Schwerpunkt Anwendungsentwicklung deckt die fachliche Tiefe der FIAE-Prüfung ab: Datenmodellierung mit ER-Diagrammen und Normalisierung von der ersten bis zur dritten Normalform, Objektorientierte Programmierung mit Klassen, Vererbung, Polymorphie und Interfaces sowie den prüfungsrelevanten Design-Patterns (Singleton, Factory, Observer, MVC), Algorithmen und Datenstrukturen mit Sortier- und Suchverfahren inklusive Laufzeitkomplexität in O-Notation, Software-Test auf Unit-, Integrations- und System-Ebene mit Coverage-Metriken sowie SQL mit DML, DDL, JOINs, Subqueries, Aggregation und Window Functions auf Prüfungsniveau. ExamFit kombiniert kompakte Theorie mit In-Browser-Programmierübungen und einem KI-Tutor, der Code-Beispiele mit Erklärung und Quellenangaben liefert.",
    keyFacts: [
      { label: "Datenmodellierung", value: "ER-Diagramme, Normalisierung 1NF-3NF" },
      { label: "OOP", value: "Klassen, Vererbung, Polymorphie, Interfaces" },
      { label: "Algorithmen", value: "Sortieren, Suchen, Laufzeitkomplexität" },
      { label: "SQL", value: "DML, DDL, JOINs, Subqueries, Aggregation" },
      { label: "Test", value: "Unit-, Integrations- und System-Test" },
    ],
    faq: [
      { q: "Welche OOP-Sprache wird in Beispielen verwendet?", a: "Java und C# als Hauptbeispiele, Python für algorithmische Aufgaben." },
      { q: "Wie tief geht SQL?", a: "Bis zu komplexen JOINs, Subqueries, Aggregation, Window Functions auf Prüfungsniveau." },
      { q: "Werden Design-Patterns behandelt?", a: "Ja, die prüfungsrelevanten: Singleton, Factory, Observer, MVC." },
      { q: "Sind UML-Diagramme enthalten?", a: "Ja, Klassen-, Sequenz- und Use-Case-Diagramme mit Übungen." },
      { q: "Wie übe ich Algorithmen?", a: "In-Browser-Aufgaben mit automatischer Laufzeit- und Korrektheitsprüfung." },
      { q: "Werden Frameworks behandelt?", a: "Frameworks selbst sind nicht prüfungsrelevant, nur die zugrundeliegenden Konzepte." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },
  {
    path: "/fiae-wiso",
    title: "FIAE: Wirtschafts- und Sozialkunde (WiSo) | ExamFit",
    description:
      "FIAE-WiSo-Prüfung vorbereiten: Berufsausbildung, Arbeitsrecht, Sozialversicherung, Wirtschaft, Tarifrecht – mit Übungsfragen und Probeklausur.",
    h1: "FIAE: Wirtschafts- und Sozialkunde",
    intro:
      "Die WiSo-Prüfung in der FIAE-Abschlussprüfung deckt fünf Themengebiete ab: Berufsausbildung mit dem Berufsbildungsgesetz (BBiG), dem Ausbildungsvertrag und der Rolle der zuständigen Stelle; Arbeitsrecht mit Kündigungsschutz, Arbeitszeitgesetz und Urlaubsanspruch; Sozialversicherung mit Kranken-, Renten-, Arbeitslosen- und Pflegeversicherung inklusive Beitragssätzen und Wahltarifen; Wirtschaftsordnung mit Marktwirtschaft, Wettbewerb und Konjunkturzyklen; sowie Tarifrecht und betriebliche Mitbestimmung nach Betriebsverfassungsgesetz. ExamFit liefert je Thema einen kompakten Lernpfad mit umfangreichem Übungsfragen-Pool mit Erklärung und mehreren Probeklausuren im prüfungsnahen DIHK-Format mit automatischer Auswertung.",
    keyFacts: [
      { label: "Themen", value: "Berufsausbildung, Arbeitsrecht, Sozialversicherung, Wirtschaft, Tarif" },
      { label: "Format", value: "30-50 Multiple-Choice-Aufgaben, 60 Min" },
      { label: "Übungen", value: "Umfangreicher Übungsfragen-Pool mit Erklärung" },
      { label: "Probeklausur", value: "Im prüfungsnahen DIHK-Format" },
      { label: "Aktualität", value: "Synchron mit BBiG- und Sozialgesetzbuch-Änderungen" },
    ],
    faq: [
      { q: "Wie viele Aufgaben hat die WiSo-Prüfung?", a: "Üblicherweise 30-50 Multiple-Choice-Aufgaben, je nach Bundesland leicht variierend. Aktuelle Vorgaben siehe deine zuständige IHK." },
      { q: "Welche Themen sind am wichtigsten?", a: "Berufsausbildung und Arbeitsrecht haben üblicherweise das höchste Gewicht." },
      { q: "Wird Politik abgefragt?", a: "Wirtschaftsordnung und Mitbestimmung ja, Tagespolitik nein." },
      { q: "Wie übe ich Sozialversicherung?", a: "Mit Fallstudien zu Beitragssätzen, Leistungen und Wahltarifen." },
      { q: "Sind die Inhalte für IT-Berufe spezifisch?", a: "Nein, WiSo ist berufsübergreifend. Inhalte gelten für alle dualen Berufe." },
      { q: "Gibt es eine Probeklausur?", a: "Ja, mehrere Probeklausuren im prüfungsnahen Format mit automatischer Auswertung." },
    ],
    sitemapGroup: "content",
    priority: 0.6,
    changefreq: "monthly",
  },
  {
    path: "/fiae-projektarbeit",
    title: "FIAE: Projektarbeit – Antrag, Doku, Präsentation | ExamFit",
    description:
      "FIAE-Projektarbeit vorbereiten: Projektantrag, Dokumentation, Präsentation, Fachgespräch. Vorlagen, Bewertungsraster, Fachgespräch-Simulator.",
    h1: "FIAE: Projektarbeit",
    intro:
      "Die betriebliche Projektarbeit ist Kern von Teil 2 der FIAE-Prüfung: Du planst und dokumentierst ein reales betriebliches Projekt (typisch 70-80 Stunden), reichst einen Antrag ein, lieferst eine Dokumentation und stellst dein Projekt im Fachgespräch vor. ExamFit liefert Vorlagen für jeden Schritt: Projektantrag (mit Beispielen für angenommene Anträge), Dokumentations-Struktur, Präsentations-Template und einen KI-Fachgesprächs-Simulator, der typische Folgefragen stellt und dein Antwortverhalten analysiert.",
    keyFacts: [
      { label: "Projektantrag", value: "Vorlagen + 10 angenommene Beispiele" },
      { label: "Dokumentation", value: "Strukturvorlage mit Bewertungsraster" },
      { label: "Präsentation", value: "Template + an DIHK-Anforderungen orientierte Bewertungskriterien" },
      { label: "Fachgespräch", value: "KI-Simulator mit typischen Folgefragen" },
      { label: "Bewertung", value: "An DIHK-Anforderungen orientierte Bewertungskriterien mit Beispielen" },
    ],
    faq: [
      { q: "Wie lang sollte die Projektarbeit dauern?", a: "Übliche Vorgabe: 70-80 Stunden. Verbindlich ist die Vorgabe deiner zuständigen IHK." },
      { q: "Was passiert, wenn der Antrag abgelehnt wird?", a: "Du kannst nachbessern und erneut einreichen. ExamFit zeigt typische Ablehnungsgründe und Best Practices." },
      { q: "Wie wird die Doku bewertet?", a: "An den DIHK-Bewertungskriterien orientiert: fachliche Tiefe, Methodenwahl, Dokumentationsqualität, wirtschaftliche Aspekte." },
      { q: "Wie lang ist die Präsentation?", a: "Typisch 15 Minuten Präsentation + 15 Minuten Fachgespräch. Verbindlich ist die Vorgabe deiner IHK." },
      { q: "Wie übe ich das Fachgespräch?", a: "Im KI-Simulator stellt der Tutor typische Folgefragen aus deinem Projektthema und gibt Feedback." },
      { q: "Welche Projektthemen sind typisch?", a: "Webanwendungen, Backend-Services, Datenbankoptimierung, Automatisierung. Vorlagen und Beispiele in der Plattform." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },
  // ────────────────────────────────────────────────────────────
  // Public-Funnel-Hub Routen (SEO Production Architecture v2)
  // /berufe Hub + 5 Pilot-Berufsdetailseiten + /produkte
  // ────────────────────────────────────────────────────────────
  {
    path: "/berufe",
    title: "IHK-Berufe Übersicht – Prüfungstraining wählen | ExamFit",
    description:
      "Wähle deinen IHK- oder HWK-Beruf und starte sofort mit prüfungsnahem Training: über 200 Berufe, Lernkurse, KI-Tutor und Simulationen.",
    h1: "Berufe – wähle deinen Prüfungspfad",
    intro:
      "Über 200 anerkannte IHK- und HWK-Ausbildungsberufe sind in ExamFit hinterlegt. Wähle deinen Beruf, starte den kostenlosen Selbsttest und erhalte einen 4-Wochen-Lernplan, der genau auf die Prüfungsformate deines Berufs zugeschnitten ist – schriftliche Aufgaben, praktische Prüfungsteile und das mündliche Fachgespräch werden abgedeckt. Beruf auswählen & Prüfungstraining starten – in unter einer Minute.",
    contentHtml: `<h2>Beliebte Berufe</h2><ul>
<li><a href="/berufe/einzelhandelskaufmann-frau">Einzelhandelskaufmann/-frau</a></li>
<li><a href="/berufe/kaufmann-frau-bueromanagement">Kaufmann/-frau für Büromanagement</a></li>
<li><a href="/berufe/industriekaufmann-frau">Industriekaufmann/-frau</a></li>
<li><a href="/berufe/fachinformatiker-systemintegration">Fachinformatiker/-in Systemintegration</a></li>
<li><a href="/berufe/kfz-mechatroniker-in">Kfz-Mechatroniker/-in</a></li>
</ul><p><a href="/preise">Preise ab 24,90 €</a> &middot; <a href="/produkte">Komplettpaket ansehen</a></p>`,
    keyFacts: [
      { label: "Berufe", value: "Über 200 IHK- und HWK-Berufe" },
      { label: "Format", value: "Lernkurse + Mini-Checks + KI-Tutor + Simulation" },
      { label: "Free", value: "Selbsttest + Lernplan kostenlos" },
      { label: "Preis", value: "Komplettpaket 24,90 € einmalig" },
      { label: "Update", value: "Synchron mit DIHK-Rahmenstoffplänen" },
    ],
    faq: [
      { q: "Wie finde ich meinen Beruf?", a: "Wähle aus der Übersichtsliste oder nutze die Suche. Insgesamt sind über 200 IHK- und HWK-Berufe hinterlegt." },
      { q: "Was kostet das Training?", a: "Selbsttest und Basis-Lernplan sind kostenlos. Vollzugriff auf eine Prüfung als Komplettpaket 24,90 € einmalig, 12 Monate gültig." },
      { q: "Sind die Inhalte IHK-spezifisch?", a: "Die Inhalte basieren auf den DIHK-Rahmenstoffplänen und gelten bundesweit für alle Industrie- und Handelskammern." },
      { q: "Gibt es Simulationen?", a: "Ja, jeder Kurs enthält prüfungsnahe Simulationen mit Readiness-Score." },
      { q: "Wann starte ich am besten?", a: "Sofort – der Lernplan rechnet rückwärts ab Prüfungstermin und priorisiert Schwächen automatisch." },
      { q: "Was ist im Komplettpaket?", a: "12 Monate Vollzugriff auf eine Prüfung inkl. KI-Tutor, Simulationen, Mini-Checks und Lernplan." },
    ],
    sitemapGroup: "static",
    priority: 0.95,
    changefreq: "weekly",
  },
  ...berufDetail("einzelhandelskaufmann-frau", "Einzelhandelskaufmann/-frau", "IHK"),
  ...berufDetail("kaufmann-frau-bueromanagement", "Kaufmann/-frau für Büromanagement", "IHK"),
  ...berufDetail("industriekaufmann-frau", "Industriekaufmann/-frau", "IHK"),
  ...berufDetail("fachinformatiker-systemintegration", "Fachinformatiker/-in Systemintegration", "IHK"),
  ...berufDetail("kfz-mechatroniker-in", "Kfz-Mechatroniker/-in", "HWK"),
  {
    path: "/produkte",
    title: "Komplettpaket Prüfungstraining – 24,90 € | ExamFit",
    description:
      "Das ExamFit Komplettpaket: 12 Monate Vollzugriff auf eine Prüfung – Lernkurse, KI-Tutor, Mini-Checks und Simulationen für 24,90 € einmalig.",
    h1: "Komplettpaket Prüfungstraining",
    intro:
      "Mit dem ExamFit Komplettpaket bekommst du für 24,90 € einmalig 12 Monate Vollzugriff auf eine gewählte Prüfung. Enthalten sind alle strukturierten Lernkurse, der adaptive 4-Wochen-Lernplan, der KI-Tutor mit Strict-RAG und Quellenangaben, alle Mini-Checks pro Lektion und mehrere prüfungsnahe Simulationen mit Readiness-Score. Kein Abo, keine versteckten Kosten, jederzeit verfügbar.",
    contentHtml: `<p><strong>Preis: 24,90 € einmalig pro Prüfung.</strong> <a href="/berufe">Jetzt Beruf wählen & starten</a></p>`,
    keyFacts: [
      { label: "Preis", value: "24,90 € einmalig" },
      { label: "Laufzeit", value: "12 Monate Vollzugriff" },
      { label: "Inhalt", value: "Lernkurse + KI-Tutor + Mini-Checks + Simulationen" },
      { label: "Format", value: "Web + Mobile, kein App-Zwang" },
      { label: "Garantie", value: "14 Tage Widerrufsrecht (B2C)" },
    ],
    faq: [
      { q: "Ist das ein Abo?", a: "Nein, das Komplettpaket ist ein einmaliger Kauf für 24,90 €, gültig 12 Monate." },
      { q: "Was ist alles enthalten?", a: "Alle Lernkurse, KI-Tutor mit Quellen, Mini-Checks, prüfungsnahe Simulationen mit Readiness-Score und 4-Wochen-Lernplan." },
      { q: "Kann ich auf mehrere Prüfungen zugreifen?", a: "Ein Komplettpaket gilt für eine Prüfung. Für weitere Prüfungen kaufst du jeweils ein separates Paket." },
      { q: "Wie schnell habe ich Zugang?", a: "Sofort nach Bezahlung – Zugriff wird automatisch freigeschaltet." },
      { q: "Welche Zahlungsmethoden?", a: "SEPA, Kreditkarte und Sofortüberweisung über Stripe." },
      { q: "Gibt es Rabatte für Betriebe?", a: "Ja, Betriebs-Bundles ab 5 Sitzen mit Reporting – siehe /preise." },
    ],
    sitemapGroup: "products",
    priority: 0.9,
    changefreq: "weekly",
  },
];

function berufDetail(slug: string, title: string, kammer: "IHK" | "HWK"): SeoRoute[] {
  const path = `/berufe/${slug}`;
  return [{
    path,
    title: `${title} – Prüfungstraining (${kammer}) | ExamFit`,
    description: `Prüfungsvorbereitung für ${title} (${kammer}): adaptiver Lernplan, KI-Tutor mit Quellen, Mini-Checks und prüfungsnahe Simulationen. Komplettpaket 24,90 €.`,
    h1: `${title} – Prüfungstraining`,
    intro: `Strukturierte Online-Vorbereitung für die ${kammer}-Abschlussprüfung als ${title}. ExamFit liefert einen adaptiven 4-Wochen-Lernplan, der deinen Schwachstellen folgt, sowie kompakte Lernkurse pro Handlungsfeld, einen KI-Tutor mit Strict-RAG und Quellenangaben, Mini-Checks zur sofortigen Wissenskontrolle und mehrere prüfungsnahe Simulationen mit Readiness-Score. Inhalte basieren auf dem aktuellen DIHK-Rahmenstoffplan für den Beruf ${title} und decken sowohl die schriftliche als auch das mündliche Fachgespräch ab. Starte mit dem kostenlosen Selbsttest und sieh nach 5 Fragen, wo deine größten Lücken sind.`,
    contentHtml: `<p><a href="/preise"><strong>Komplettpaket 24,90 €</strong> – 12 Monate Vollzugriff</a> &middot; <a href="/berufe">Anderen Beruf wählen</a></p><h2>Was ist enthalten?</h2><ul><li>Adaptiver 4-Wochen-Lernplan, rückwärts ab Prüfungstermin</li><li>Lernkurse pro Handlungsfeld nach DIHK-Rahmenstoffplan</li><li>KI-Tutor mit Quellenangaben (Strict-RAG, keine Halluzinationen)</li><li>Mini-Checks pro Lektion mit sofortigem Feedback</li><li>Prüfungsnahe Simulationen mit Readiness-Score</li><li>Mündliches Fachgespräch als KI-Simulation</li></ul>`,
    keyFacts: [
      { label: "Beruf", value: title },
      { label: "Kammer", value: kammer },
      { label: "Lernplan", value: "4 Wochen, adaptiv" },
      { label: "Preis", value: "Komplettpaket 24,90 € einmalig" },
      { label: "Free", value: "Selbsttest + Basis-Lernplan kostenlos" },
    ],
    faq: [
      { q: `Wie bereite ich mich auf die ${title}-Prüfung vor?`, a: `Starte mit dem kostenlosen Selbsttest. ExamFit erstellt daraus einen 4-Wochen-Lernplan, der genau die Handlungsfelder priorisiert, in denen du noch Lücken hast.` },
      { q: "Was kostet das Komplettpaket?", a: "Einmalig 24,90 € für 12 Monate Vollzugriff auf alle Inhalte zu diesem Beruf." },
      { q: "Ist die Vorbereitung IHK-konform?", a: "Inhalte basieren auf dem aktuellen DIHK-Rahmenstoffplan und werden bei Änderungen nachgezogen." },
      { q: "Gibt es Übungen für das mündliche Fachgespräch?", a: "Ja, der KI-Tutor simuliert typische Fachgespräche und gibt Feedback zu Struktur und Vollständigkeit deiner Antworten." },
      { q: "Wie funktionieren die Simulationen?", a: "Prüfungsnahe Aufgaben mit Zeitlimit, automatischer Bewertung und Readiness-Score, der deine Prüfungsreife einschätzt." },
      { q: "Kann ich das Training mobil nutzen?", a: "Ja, ExamFit funktioniert auf Smartphone, Tablet und Desktop ohne App-Zwang." },
    ],
    sitemapGroup: "static",
    priority: 0.85,
    changefreq: "weekly",
  }];
}

// Inject default JSON-LD on every entry: Organization, Breadcrumb, FAQ
for (const r of live) {
  const breadcrumb = breadcrumbJsonLd([
    { name: "Start", path: "/" },
    { name: r.h1, path: r.path },
  ]);
  r.jsonLd = [orgJsonLd, breadcrumb, faqJsonLd(r.faq)];
}

// ────────────────────────────────────────────────────────────
// STUB ROUTES (skipped from prerender, present for inventory)
// Filled in next iteration – content TBD.
// ────────────────────────────────────────────────────────────
const stubs: SeoRoute[] = [
  // AEVO cluster
  ...stubGroup("static", [
    "/aevo-pruefungsvorbereitung",
    "/aevo-schriftliche-pruefung",
    "/aevo-praktische-pruefung",
    "/aevo-fachgespraech",
  ]),
  // IHK cluster
  ...stubGroup("static", [
    "/ihk-pruefungen",
    "/ihk-pruefungsvorbereitung",
    "/ihk-pruefungsfragen",
    "/ihk-fachgespraech",
    "/ihk-probepruefung",
  ]),
  // Wirtschaftsfachwirt
  ...stubGroup("content", ["/wirtschaftsfachwirt"]),
  // Berufe-Hub ist live (siehe oben), keine Stubs hier.
  // Bundles / Wissen
  ...stubGroup("products", ["/bundles", "/wissen"]),
];

function stubGroup(group: SitemapGroup, paths: string[]): SeoRoute[] {
  return paths.map((p) => ({
    path: p,
    title: "ExamFit",
    description: "ExamFit",
    h1: "ExamFit",
    intro: "",
    keyFacts: [],
    faq: [],
    sitemapGroup: group,
    status: "stub" as const,
  }));
}

for (const r of live) (r as SeoRoute).status = "live";

export const seoRoutes: SeoRoute[] = [...live, ...stubs];

export const liveSeoRoutes = seoRoutes.filter((r) => r.status === "live");

export function getSeoRoute(path: string): SeoRoute | undefined {
  return seoRoutes.find((r) => r.path === path);
}
