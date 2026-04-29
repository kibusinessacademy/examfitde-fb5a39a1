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

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ExamFit",
  url: SITE,
  logo: `${SITE}/pwa-512x512.png`,
  sameAs: [],
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
    title: "ExamFit – KI-Prüfungstraining für IHK, AEVO, Fachwirt, Meister",
    description:
      "Bestehe deine IHK-, AEVO-, Bilanzbuchhalter- oder FIAE-Prüfung mit adaptivem Lernplan, echten Prüfungssimulationen und KI-Tutor mit Quellenangaben.",
    h1: "Bestehe deine Prüfung – mit System statt Glück",
    intro:
      "ExamFit ist ein adaptives Prüfungstrainings-System für IHK-Abschlussprüfungen, Fachwirt-, Meister-, AEVO-, Bilanzbuchhalter- und Fachinformatiker-Prüfungen. Die Plattform analysiert in einem kostenlosen Selbsttest deine Schwachstellen und erstellt einen 4-Wochen-Lernplan, der Lernkurse, Übungsfragen, Mini-Checks und einen KI-Tutor mit Quellenangaben kombiniert. Am Ende stehen realistische Prüfungssimulationen mit Readiness-Score, der dir eine fundierte Einschätzung deines Vorbereitungsstands gibt. Kein generisches Lernmaterial, sondern passgenaue Vorbereitung auf deine Prüfung – schriftlich, praktisch oder mündliches Fachgespräch. ExamFit unterstützt Auszubildende, Fortbildungsteilnehmer und angehende Ausbilder bei der strukturierten Prüfungsvorbereitung mit prüfungsnahen Aufgabenformaten.",
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
      { q: "Gibt es echte Prüfungssimulationen?", a: "Ja – mit den Originalformaten der jeweiligen Prüfung (schriftlich + mündlich), inklusive Zeitlimit und Punkteauswertung." },
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

  // 3. Blog
  {
    path: "/blog",
    title: "Blog – Prüfungstipps, IHK-Updates, Lernstrategien | ExamFit",
    description:
      "Aktuelle Beiträge zu IHK-Prüfungen, AEVO, Bilanzbuchhalter, FIAE: Lernstrategien, Prüfungstipps, neue Rahmenstoffpläne und Erfahrungsberichte.",
    h1: "Blog: Prüfungstipps & IHK-Updates",
    intro:
      "Der ExamFit-Blog liefert konkrete Lernstrategien, Updates zu IHK-Rahmenstoffplänen, Erfahrungsberichte von Prüflingen und Hintergründe zu didaktischen Methoden. Themenschwerpunkte sind die schriftliche und mündliche IHK-Prüfung, AEVO-Vorbereitung, Bilanzbuchhalter und Fachinformatiker. Jeder Beitrag enthält praxisnahe Beispiele, Checklisten und Verweise auf passende Lernkurse oder Selbsttests. Beiträge werden redaktionell von Experten mit IHK-Hintergrund kuratiert.",
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
      { q: "Gibt es einen RSS-Feed?", a: "Ja, unter examfit.de/feed.xml." },
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
      "Hier findest du Antworten auf die häufigsten Fragen zur Plattform, zu IHK-Prüfungen und zur Funktionsweise des adaptiven Lernsystems. Die FAQ ist gegliedert in: Plattform & Tarife, Prüfungsorganisation, Lernmethodik, KI-Tutor sowie Datenschutz. Sollte deine Frage hier nicht beantwortet sein, erreichst du den Support unter info@examfit.de.",
    keyFacts: [
      { label: "Themenbereiche", value: "Plattform, Prüfung, Lernmethodik, KI, Datenschutz" },
      { label: "Support", value: "info@examfit.de" },
      { label: "Antwortzeit", value: "Werktags innerhalb 24 Stunden" },
      { label: "Sprachen", value: "Deutsch" },
      { label: "Wissensbasis", value: "Über 200 beantwortete Fragen" },
    ],
    faq: [
      { q: "Wie starte ich mit ExamFit?", a: "Mache den kostenlosen Selbsttest – danach erhältst du einen 4-Wochen-Lernplan." },
      { q: "Was kostet die Plattform?", a: "Selbsttest und Basis-Lernplan sind kostenlos. Vollzugriff ab 19 € / Monat oder als Einmalkauf je Prüfung." },
      { q: "Kann ich monatlich kündigen?", a: "Ja, monatliche Abos sind jederzeit zum Monatsende kündbar." },
      { q: "Funktioniert der KI-Tutor offline?", a: "Nein, der KI-Tutor benötigt eine Internetverbindung. Lernkurse können teilweise offline genutzt werden (PWA)." },
      { q: "Bekomme ich Rechnung mit MwSt.?", a: "Ja, jede Bestellung erzeugt automatisch eine Rechnung mit ausgewiesener MwSt." },
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
      { label: "Mobile", value: "PWA – läuft auch unterwegs" },
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
    title: "Prüfungstraining für Betriebe – Azubis durchbringen | ExamFit",
    description:
      "ExamFit für Ausbildungsbetriebe: einheitliches Prüfungstraining für alle Azubis, Reporting, Lernfortschritt pro Lehrjahr, faire Preise pro Sitz.",
    h1: "Prüfungstraining für Ausbildungsbetriebe",
    intro:
      "ExamFit hilft Ausbildungsbetrieben, ihre Bestehensquote bei IHK-Abschlussprüfungen messbar zu steigern. Das Betriebs-Bundle gibt jedem Azubi einen Sitzplatz, einheitliche Lernkurse und persönliche Lernpläne, während der Ausbilder im Reporting den Lernfortschritt pro Lehrjahr und Handlungsfeld sieht. So erkennst du frühzeitig, welche Azubis Risiken zeigen und in welchen Bereichen Schulungsbedarf besteht. Onboarding pro Cohort dauert typisch unter 30 Minuten, alle Azubis können sofort loslegen.",
    keyFacts: [
      { label: "Lizenzmodell", value: "Pro Sitz, monatlich oder jährlich" },
      { label: "Reporting", value: "Lernfortschritt pro Azubi & Handlungsfeld" },
      { label: "Onboarding", value: "Bulk-Invite per E-Mail, < 30 Min Setup" },
      { label: "Updates", value: "Inhalte synchron mit DIHK-Rahmenstoffplan" },
      { label: "Datenschutz", value: "DSGVO, EU-Hosting (Frankfurt)" },
      { label: "Support", value: "Dedizierter Account-Manager ab 25 Sitzen" },
    ],
    faq: [
      { q: "Wie viele Sitzplätze sind Minimum?", a: "Es gibt kein Minimum – Bundles starten ab 5 Sitzen, skalieren bis 1000+." },
      { q: "Wie funktioniert die Abrechnung?", a: "Monatlich oder jährlich pro Sitz, Rechnung mit ausgewiesener MwSt." },
      { q: "Sehen wir, wie weit Azubis sind?", a: "Ja, im Betriebs-Cockpit pro Azubi und pro Handlungsfeld – ohne einzelne Antworten einzusehen." },
      { q: "Können Azubis ihre Daten mitnehmen?", a: "Ja, der Lernfortschritt gehört dem Azubi und kann nach Ausscheiden in einen privaten Account migriert werden." },
      { q: "Gibt es eine Pilotphase?", a: "Ja, 14 Tage Test mit voller Funktionalität für bis zu 10 Sitze." },
      { q: "Welche Ausbildungsberufe werden abgedeckt?", a: "Alle dualen IHK-Berufe mit DIHK-Rahmenstoffplan." },
    ],
    sitemapGroup: "static",
    priority: 0.85,
    changefreq: "weekly",
  },

  // 7. Pruefungstraining Institutionen
  {
    path: "/pruefungstraining-institutionen",
    title: "Prüfungstraining für Bildungsträger & Berufsschulen | ExamFit",
    description:
      "ExamFit für Berufsschulen, Bildungsträger und Kammern: Lehrer-Cockpit, Klassenverwaltung, Lernfortschritt pro Schüler, faire Volumen-Preise.",
    h1: "Prüfungstraining für Bildungsträger & Berufsschulen",
    intro:
      "ExamFit liefert Berufsschulen, Bildungsträgern und Kammern ein einheitliches digitales Prüfungstraining. Lehrer organisieren Klassen im Cockpit, weisen Lernpfade zu und sehen den Lernfortschritt pro Schüler – ohne in einzelne Antworten Einsicht zu nehmen (datenschutzkonform). Schüler bekommen adaptive Lernpläne und Simulationen. Für größere Institutionen gibt es SSO (SAML), API-Zugang und individuelle Reporting-Exports.",
    keyFacts: [
      { label: "Lizenzmodell", value: "Pro Lernplatz, Volumenrabatte ab 50 Sitzen" },
      { label: "SSO", value: "SAML 2.0 für Enterprise-Pakete" },
      { label: "Klassen", value: "Lehrer-Cockpit mit Klassen, Lernpfaden, Reports" },
      { label: "Datenschutz", value: "DSGVO, EU-Hosting, AVV verfügbar" },
      { label: "Onboarding", value: "Bulk-Import per CSV oder API" },
      { label: "Support", value: "Dedizierter Account-Manager + SLA" },
    ],
    faq: [
      { q: "Bietet ihr SSO an?", a: "Ja, SAML 2.0 ist im Enterprise-Paket enthalten." },
      { q: "Können wir eigene Inhalte einspielen?", a: "Ja, über die LTI-1.3-Schnittstelle und über das Curriculum-Authoring." },
      { q: "Wie sieht es mit Datenschutz aus?", a: "DSGVO-konform, EU-Hosting (Frankfurt), AVV nach Art. 28 wird bereitgestellt." },
      { q: "Wie viele Sitze sind möglich?", a: "Von 50 bis 10.000+ Lernplätze, je nach Ausschreibung individuell." },
      { q: "Können wir Reports exportieren?", a: "Ja, als CSV oder über API (REST) im Enterprise-Paket." },
      { q: "Gibt es einen Demo-Termin?", a: "Ja, über das Kontaktformular kannst du eine Demo mit Account-Manager buchen." },
    ],
    sitemapGroup: "static",
    priority: 0.8,
    changefreq: "weekly",
  },

  // 8. Preise
  {
    path: "/preise",
    title: "Preise – ExamFit Tarife für Azubis, Betriebe & Bildungsträger",
    description:
      "Transparente Preise: kostenloser Selbsttest, Einzeltarife ab 19 €/Monat, Betriebs-Bundles pro Sitz, Bildungsträger-Lizenzen mit Volumenrabatt.",
    h1: "ExamFit-Preise",
    intro:
      "ExamFit bietet drei Tarif-Segmente: (1) Privat für einzelne Auszubildende und Fortbildungsteilnehmer ab 19 € pro Monat (oder Einmalkauf je Prüfung), (2) Betriebs-Bundles pro Sitz für Ausbildungsbetriebe mit Reporting, (3) Institutions-Lizenzen mit Volumenrabatt, SSO und API-Zugang. Alle Preise verstehen sich zzgl. MwSt., Rechnungen werden automatisch erzeugt. Der Selbsttest und Basis-Lernplan sind dauerhaft kostenlos.",
    keyFacts: [
      { label: "Free", value: "Selbsttest + Basis-Lernplan – dauerhaft kostenlos" },
      { label: "Privat", value: "Ab 19 € / Monat, monatlich kündbar" },
      { label: "Einmalkauf", value: "Pro Prüfung, gültig 12 Monate" },
      { label: "Betriebe", value: "Pro Sitz, ab 5 Sitzen, mit Reporting" },
      { label: "Institutionen", value: "Volumenrabatt + SSO + API" },
      { label: "Zahlung", value: "SEPA, Kreditkarte, Rechnung (B2B)" },
    ],
    faq: [
      { q: "Gibt es eine kostenlose Variante?", a: "Ja, Selbsttest und Basis-Lernplan sind dauerhaft kostenlos." },
      { q: "Kann ich monatlich kündigen?", a: "Ja, monatliche Tarife sind jederzeit zum Monatsende kündbar." },
      { q: "Was kostet ein Betriebs-Sitz?", a: "Abhängig von Volumen, ab ca. 12 € pro Sitz pro Monat. Detailpreise auf Anfrage." },
      { q: "Bekomme ich eine Rechnung?", a: "Ja, jede Bestellung erzeugt automatisch eine Rechnung mit ausgewiesener MwSt." },
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
    title: "Bilanzbuchhalter Prüfungsvorbereitung – komplett online | ExamFit",
    description:
      "Strukturierte Online-Vorbereitung für die IHK-Bilanzbuchhalter-Prüfung: Lernplan, Übungsklausuren, KI-Tutor mit Quellen, alle Handlungsbereiche.",
    h1: "Bilanzbuchhalter Prüfungsvorbereitung",
    intro:
      "Die ExamFit-Vorbereitung auf die geprüfte Bilanzbuchhalter-Prüfung deckt alle drei schriftlichen Handlungsbereiche ab: Geschäftsvorfälle erfassen und Jahresabschlüsse erstellen, Jahresabschlüsse analysieren und auswerten, Steuerrecht. Hinzu kommt die mündliche Prüfung (Situationsaufgabe + Fachgespräch). Adaptive Lernpläne priorisieren deine schwächsten Bereiche, Übungsklausuren simulieren Originalformate und der KI-Tutor beantwortet Fragen mit belegten Quellen aus dem Curriculum. Inhalte sind synchron mit der DIHK-Rechtsverordnung.",
    keyFacts: [
      { label: "Handlungsbereiche", value: "Buchhaltung, Jahresabschluss, Steuern" },
      { label: "Mündliche Prüfung", value: "Situationsaufgabe + Fachgespräch im Simulator" },
      { label: "Übungsklausuren", value: "Mit Original-Punktebewertung der DIHK" },
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
      "Handlungsbereich 1 der Bilanzbuchhalter-Prüfung deckt die laufende Buchführung ab: Geschäftsvorfälle erfassen und kontieren, Anlagenbuchhaltung, Personalbuchhaltung, Umsatzsteuer-Voranmeldung. ExamFit liefert hierfür einen strukturierten Lernpfad mit Übungsbuchungen, Kontierungs-Trainer und Fallstudien. Der KI-Tutor erklärt Buchungssätze mit Verweis auf HGB-Paragraphen. Realistische Simulationen entsprechen dem Originalformat der DIHK-Klausur.",
    keyFacts: [
      { label: "Themen", value: "Kontierung, Anlagenbuchhaltung, Personal, USt" },
      { label: "Trainer", value: "Kontierungs-Trainer mit über 500 Fällen" },
      { label: "Fallstudien", value: "Praxisnahe Geschäftsvorfälle aus KMU" },
      { label: "Tutor", value: "Erklärt Buchungssätze mit HGB-Bezug" },
      { label: "Klausurformat", value: "Original DIHK-Aufgabenstil" },
    ],
    faq: [
      { q: "Wie viele Übungsbuchungen sind enthalten?", a: "Über 500 kontierte Geschäftsvorfälle aus typischen KMU-Konstellationen." },
      { q: "Werden auch internationale Standards behandelt?", a: "Schwerpunkt ist HGB; IFRS wird in Handlungsbereich 2 vertiefend behandelt." },
      { q: "Ist die Anlagenbuchhaltung enthalten?", a: "Ja, inklusive Abschreibungsmethoden und außerplanmäßiger Abschreibung." },
      { q: "Wie lange dauert dieser Bereich?", a: "Empfohlen 4-6 Wochen, abhängig von Vorkenntnissen." },
      { q: "Gibt es Probeklausuren?", a: "Ja, drei Probeklausuren im Originalformat mit automatischer Auswertung." },
      { q: "Kann ich nur Buchhaltung kaufen?", a: "Ja, jeder Handlungsbereich ist einzeln buchbar." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },
  {
    path: "/bilanzbuchhalter-jahresabschluss",
    title: "Bilanzbuchhalter: Jahresabschluss – Handlungsbereich 2 | ExamFit",
    description:
      "Handlungsbereich 2 der Bilanzbuchhalter-Prüfung: Jahresabschluss erstellen und auswerten, Bilanzanalyse, IFRS-Grundlagen, Übungen + Klausuren.",
    h1: "Bilanzbuchhalter: Jahresabschluss",
    intro:
      "Handlungsbereich 2 fokussiert auf die Erstellung und Auswertung von Jahresabschlüssen nach HGB sowie Grundlagen der internationalen Rechnungslegung (IFRS). Inhaltlich enthalten: Bilanzpolitik, Bewertungsmethoden, Anhang und Lagebericht, Kapitalflussrechnung, Bilanzanalyse mit Kennzahlen sowie ein vergleichender Überblick HGB/IFRS. ExamFit liefert vollständige Übungs-Jahresabschlüsse mit Lösungswegen und einen Bilanzanalyse-Trainer mit Kennzahlen-Berechnung.",
    keyFacts: [
      { label: "Themen", value: "HGB-Jahresabschluss, IFRS-Grundlagen, Bilanzanalyse" },
      { label: "Übungen", value: "Vollständige Jahresabschlüsse mit Lösungsweg" },
      { label: "Kennzahlen", value: "Trainer mit über 30 betriebswirtschaftlichen Kennzahlen" },
      { label: "IFRS", value: "Vergleichender Überblick HGB/IFRS" },
      { label: "Klausuren", value: "Drei Probeklausuren im DIHK-Originalformat" },
    ],
    faq: [
      { q: "Wie tief geht IFRS?", a: "Auf Niveau der DIHK-Prüfungsanforderung – Vergleich HGB/IFRS, keine Vollzertifizierung." },
      { q: "Welche Kennzahlen werden behandelt?", a: "Über 30 Kennzahlen aus Liquiditäts-, Rentabilitäts- und Vermögensanalyse." },
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
      "Handlungsbereich 3 deckt das prüfungsrelevante Steuerrecht ab: Umsatzsteuer (Tatbestände, Steuersätze, Sonderfälle), Einkommensteuer (Einkunftsarten, Sonderausgaben), Körperschaftsteuer und Gewerbesteuer. ExamFit liefert über 300 steuerliche Fallstudien, einen Steuer-Trainer mit aktueller Rechtsprechung und einen KI-Tutor, der Antworten mit EStG-, UStG- und KStG-Paragraphen belegt. Inhalte werden bei jeder relevanten Gesetzesänderung aktualisiert.",
    keyFacts: [
      { label: "Themen", value: "USt, ESt, KSt, GewSt – prüfungsrelevant" },
      { label: "Fallstudien", value: "Über 300 steuerliche Praxisfälle" },
      { label: "Aktualität", value: "Synchron mit Gesetzesänderungen" },
      { label: "Tutor", value: "Antworten mit EStG/UStG/KStG-Bezug" },
      { label: "Probeklausuren", value: "Im DIHK-Originalformat" },
    ],
    faq: [
      { q: "Welche Steuerarten werden behandelt?", a: "USt, ESt, KSt und GewSt im prüfungsrelevanten Umfang." },
      { q: "Wie aktuell ist das Steuerrecht?", a: "Inhalte werden bei jeder relevanten Gesetzesänderung (z. B. Jahressteuergesetz) aktualisiert." },
      { q: "Werden auch Doppelbesteuerungsabkommen behandelt?", a: "Grundlagen ja, Vertiefung ist nicht prüfungsrelevant." },
      { q: "Gibt es einen Umsatzsteuer-Trainer?", a: "Ja, mit Sonderfällen wie innergemeinschaftlichen Leistungen und Reverse-Charge." },
      { q: "Wie übe ich Einkommensteuer?", a: "Mit über 100 Fallstudien aus den sieben Einkunftsarten und der Veranlagungspraxis." },
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
      "ExamFit bereitet auf die Abschlussprüfung Fachinformatiker Anwendungsentwicklung (FIAE) Teil 1 + 2 vor. Inhalte: Anwendungsentwicklung (Datenmodellierung, OOP, Algorithmen, Testen), Wirtschafts- und Sozialkunde (WiSo), betriebliche Projektarbeit (Projektantrag, Dokumentation, Präsentation, Fachgespräch). Adaptive Lernpläne priorisieren Schwächen, Programmierübungen werden im Browser ausgeführt, der KI-Tutor erklärt Code mit Quellenangaben.",
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
      "Der Schwerpunkt Anwendungsentwicklung deckt die fachliche Tiefe der FIAE-Prüfung ab: Datenmodellierung (ER, Normalisierung), Objektorientierte Programmierung (Klassen, Vererbung, Polymorphie, Interfaces), Algorithmen und Datenstrukturen (Sortieren, Suchen, Komplexität), Software-Test (Unit, Integration, Coverage), SQL (DML, DDL, JOINs, Aggregation). ExamFit kombiniert Theorie mit In-Browser-Programmierübungen und einem KI-Tutor, der Code-Beispiele mit Erklärung und Quellenangaben liefert.",
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
      "Die WiSo-Prüfung in der FIAE-Abschlussprüfung deckt fünf Themengebiete ab: Berufsausbildung (BBiG, Ausbildungsvertrag), Arbeitsrecht (Kündigung, Arbeitszeitgesetz), Sozialversicherung (Kranken-, Renten-, Arbeitslosen-, Pflegeversicherung), Wirtschaftsordnung (Marktwirtschaft, Wettbewerb), Tarifrecht und Mitbestimmung. ExamFit liefert je Thema einen kompakten Lernpfad mit Übungsfragen und einer Probeklausur im DIHK-Format.",
    keyFacts: [
      { label: "Themen", value: "Berufsausbildung, Arbeitsrecht, Sozialversicherung, Wirtschaft, Tarif" },
      { label: "Format", value: "30-50 Multiple-Choice-Aufgaben, 60 Min" },
      { label: "Übungen", value: "Über 200 Übungsfragen mit Erklärung" },
      { label: "Probeklausur", value: "Im Originalformat der DIHK" },
      { label: "Aktualität", value: "Synchron mit BBiG- und Sozialgesetzbuch-Änderungen" },
    ],
    faq: [
      { q: "Wie viele Aufgaben hat die WiSo-Prüfung?", a: "Üblicherweise 30-50 Multiple-Choice-Aufgaben, je nach Bundesland leicht variierend. Aktuelle Vorgaben siehe deine zuständige IHK." },
      { q: "Welche Themen sind am wichtigsten?", a: "Berufsausbildung und Arbeitsrecht haben üblicherweise das höchste Gewicht." },
      { q: "Wird Politik abgefragt?", a: "Wirtschaftsordnung und Mitbestimmung ja, Tagespolitik nein." },
      { q: "Wie übe ich Sozialversicherung?", a: "Mit Fallstudien zu Beitragssätzen, Leistungen und Wahltarifen." },
      { q: "Sind die Inhalte für IT-Berufe spezifisch?", a: "Nein, WiSo ist berufsübergreifend. Inhalte gelten für alle dualen Berufe." },
      { q: "Gibt es eine Probeklausur?", a: "Ja, mehrere Probeklausuren im Original-Format mit automatischer Auswertung." },
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
      { label: "Präsentation", value: "Template + Bewertungsraster der DIHK" },
      { label: "Fachgespräch", value: "KI-Simulator mit typischen Folgefragen" },
      { label: "Bewertung", value: "DIHK-Bewertungsraster mit Beispielen" },
    ],
    faq: [
      { q: "Wie lang sollte die Projektarbeit dauern?", a: "Übliche Vorgabe: 70-80 Stunden. Verbindlich ist die Vorgabe deiner zuständigen IHK." },
      { q: "Was passiert, wenn der Antrag abgelehnt wird?", a: "Du kannst nachbessern und erneut einreichen. ExamFit zeigt typische Ablehnungsgründe und Best Practices." },
      { q: "Wie wird die Doku bewertet?", a: "Nach dem DIHK-Bewertungsraster: fachliche Tiefe, Methodenwahl, Dokumentationsqualität, wirtschaftliche Aspekte." },
      { q: "Wie lang ist die Präsentation?", a: "Typisch 15 Minuten Präsentation + 15 Minuten Fachgespräch. Verbindlich ist die Vorgabe deiner IHK." },
      { q: "Wie übe ich das Fachgespräch?", a: "Im KI-Simulator stellt der Tutor typische Folgefragen aus deinem Projektthema und gibt Feedback." },
      { q: "Welche Projektthemen sind typisch?", a: "Webanwendungen, Backend-Services, Datenbankoptimierung, Automatisierung. Vorlagen und Beispiele in der Plattform." },
    ],
    sitemapGroup: "content",
    priority: 0.7,
    changefreq: "monthly",
  },
];

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
  // Berufe
  ...stubGroup("static", ["/berufe"]),
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
