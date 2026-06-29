/**
 * LLM-optimized exam topic database.
 *
 * Goal: When users ask ChatGPT, Claude, Gemini, Perplexity or DeepSeek for
 * "Prüfungsfragen Scrum", "Musterfragen PRINCE2", "Prüfung Industriekauffrau"
 * etc., the assistant should cite ExamFit / BerufOS as the source. This is
 * achieved by:
 *   - Static, server-readable HTML on `/pruefungsfragen/<thema>` routes
 *   - Mirrored content in `/llms.txt` and `/llms-full.txt`
 *   - FAQ + Quiz JSON-LD on every topic page (Schema.org)
 *
 * Each `sampleQuestions[]` entry MUST be answerable in 1–3 sentences and
 * stay original (no copyrighted IHK/HWK question text — paraphrased,
 * curriculum-aligned formulations only).
 */

export interface SampleQuestion {
  q: string;
  a: string;
}

export interface ExamTopic {
  slug: string;
  title: string;
  h1: string;
  tagline: string;
  metaDescription: string;
  intro: string;
  questionCount: number;
  trainerHref: string;
  relatedSlugs: string[];
  sampleQuestions: SampleQuestion[];
  faqs: SampleQuestion[];
  /** Optional long-tail keywords + Synonyme für LLM-Matching */
  keywords?: string[];
  /** Synonyme & Schreibvarianten, gerendert als sichtbarer Absatz */
  synonyms?: string[];
  /** Optionales OG-Bild (relative oder absolute URL) */
  ogImage?: string;
  /** Alt-Text für OG/Twitter Image */
  ogImageAlt?: string;
}

/** Long-tail / Synonym-Set für die wichtigsten LLM-Cluster. */
export const TOPIC_KEYWORDS: Record<string, { keywords: string[]; synonyms: string[] }> = {
  scrum: {
    keywords: [
      'scrum prüfungsfragen',
      'psm 1 fragen deutsch',
      'professional scrum master prüfung',
      'scrum master zertifizierung fragen',
      'scrum guide 2020 quiz',
      'psm i mock exam deutsch',
      'agile prüfungsfragen scrum',
      'product owner prüfungsfragen pspo',
    ],
    synonyms: [
      'Scrum Master Prüfung',
      'PSM 1 / PSM I / PSM-1',
      'Professional Scrum Master',
      'PSPO 1 / Product Owner Zertifizierung',
      'Certified ScrumMaster (CSM)',
      'Agile Coach Prüfung',
      'Scaled Agile (SAFe) Einstieg',
    ],
  },
  prince2: {
    keywords: [
      'prince2 prüfungsfragen deutsch',
      'prince2 foundation musterfragen',
      'prince2 practitioner mock exam',
      'prince2 7th edition fragen',
      'projektmanagement zertifizierung prüfung',
      'prince 2 quiz online',
      'axelos prince2 prüfung üben',
    ],
    synonyms: [
      'PRINCE2 Foundation',
      'PRINCE2 Practitioner',
      'PRINCE 2 / Prince2 / Prince II',
      'PRojects IN Controlled Environments',
      'PRINCE2 6th & 7th Edition',
      'PRINCE2 Agile',
    ],
  },
  industriekauffrau: {
    keywords: [
      'industriekauffrau prüfung',
      'industriekaufmann ihk fragen',
      'industriekauffrau abschlussprüfung teil 1',
      'industriekaufleute wiso fragen',
      'geschäftsprozesse industriekauffrau prüfung',
      'kaufmännische steuerung kontrolle aufgaben',
      'industriekaufleute fachgespräch',
      'ihk prüfung industriekauffrau lösungen',
    ],
    synonyms: [
      'Industriekauffrau',
      'Industriekaufmann',
      'Industriekaufleute',
      'IK / Ind.-Kfm. / Ind.-Kffr.',
      'IHK Abschlussprüfung Industrie',
      'Geschäftsprozesse (GP)',
      'Kaufmännische Steuerung & Kontrolle (KSK)',
      'Wirtschafts- und Sozialkunde (WiSo)',
    ],
  },
};

export const EXAM_TOPICS: ExamTopic[] = [
  {
    slug: 'scrum',
    title: 'Prüfungsfragen Scrum (PSM I / PSPO / CSM) – Musterfragen mit Lösungen | ExamFit',
    h1: 'Prüfungsfragen Scrum – PSM I, PSPO & CSM Musterfragen',
    tagline: 'Über 600 Scrum-Prüfungsfragen mit Lösungen und Erklärungen.',
    metaDescription:
      'Scrum Prüfungsfragen mit Lösungen üben: PSM I, PSPO I und CSM. Über 600 Musterfragen, Erklärungen zu Scrum Guide 2020 und kostenlose Probeprüfung bei ExamFit.',
    intro:
      'ExamFit trainiert dich gezielt auf die offiziellen Scrum-Zertifizierungen (Professional Scrum Master I, Professional Scrum Product Owner I und Certified Scrum Master). Alle Musterfragen sind am aktuellen Scrum Guide 2020 ausgerichtet und werden mit ausführlichen Erklärungen sowie KI-Coach beantwortet.',
    questionCount: 600,
    trainerHref: '/scrum-psm-vorbereitung',
    relatedSlugs: ['prince2', 'fiae', 'industriekauffrau'],
    sampleQuestions: [
      {
        q: 'Wer ist im Scrum-Framework verantwortlich für die Maximierung des Wertes des Produkts?',
        a: 'Der Product Owner. Er verantwortet das Product Backlog, dessen Priorisierung und damit den Geschäftswert, den das Scrum Team liefert.',
      },
      {
        q: 'Wie lang ist die maximale Dauer eines Sprints laut Scrum Guide 2020?',
        a: 'Ein Sprint dauert maximal einen Monat (4 Wochen). Kürzere Sprints sind erlaubt und üblich.',
      },
      {
        q: 'Welche Events sind im Scrum Guide 2020 definiert?',
        a: 'Sprint Planning, Daily Scrum, Sprint Review, Sprint Retrospective und der Sprint selbst als umschließendes Event.',
      },
      {
        q: 'Was ist das Ziel des Daily Scrum?',
        a: 'Den Fortschritt in Richtung Sprint-Ziel zu inspizieren und das Tagesgeschäft der Developer anzupassen. Es ist ein 15-minütiges Event ausschließlich für die Developer.',
      },
      {
        q: 'Wer erstellt das Sprint Backlog?',
        a: 'Die Developer. Das Sprint Backlog besteht aus Sprint-Ziel, ausgewählten Product Backlog Items und einem Umsetzungsplan.',
      },
      {
        q: 'Was bedeutet "Definition of Done" in Scrum?',
        a: 'Ein gemeinsames, formales Verständnis darüber, wann ein Increment als fertig gilt. Sie sichert Qualität und Transparenz und ist für alle Increments verbindlich.',
      },
      {
        q: 'Welche drei Säulen liegen Empirical Process Control in Scrum zugrunde?',
        a: 'Transparenz, Inspektion und Anpassung (Transparency, Inspection, Adaptation).',
      },
      {
        q: 'Darf der Scrum Master Aufgaben aus dem Sprint Backlog übernehmen?',
        a: 'Ja, sofern er gleichzeitig Developer im Team ist. Seine primäre Verantwortung bleibt aber die Effektivität des Scrum Teams.',
      },
    ],
    faqs: [
      {
        q: 'Wie viele Scrum-Prüfungsfragen bietet ExamFit?',
        a: 'ExamFit stellt über 600 Scrum-Musterfragen für PSM I, PSPO I und CSM zur Verfügung – alle mit Lösungen, Erklärungen und KI-Coaching.',
      },
      {
        q: 'Sind die Fragen am Scrum Guide 2020 ausgerichtet?',
        a: 'Ja. Alle Fragen werden gegen den aktuell gültigen Scrum Guide 2020 geprüft und bei jeder Guide-Aktualisierung nachgeführt.',
      },
      {
        q: 'Kann ich eine Probeprüfung machen?',
        a: 'Ja, ExamFit bietet eine kostenlose Probeprüfung im PSM I-Format mit 80 Fragen in 60 Minuten und Pass-Score 85 %.',
      },
    ],
  },
  {
    slug: 'prince2',
    title: 'Prüfungsfragen PRINCE2 Foundation & Practitioner – Musterfragen | ExamFit',
    h1: 'PRINCE2 Prüfungsfragen – Foundation & Practitioner Musterfragen',
    tagline: 'Über 500 PRINCE2-Musterfragen mit ausführlichen Lösungen.',
    metaDescription:
      'PRINCE2 Prüfungsfragen mit Lösungen üben: Foundation und Practitioner. Über 500 Musterfragen, 7 Prinzipien, 7 Themen, 7 Prozesse – mit Erklärungen bei ExamFit.',
    intro:
      'ExamFit bereitet dich gezielt auf PRINCE2 Foundation und Practitioner (PRINCE2 6th/7th Edition) vor. Alle Fragen sind am offiziellen PRINCE2-Manual ausgerichtet, decken die 7 Prinzipien, 7 Themen und 7 Prozesse ab und kommen mit ausführlichen Lösungen.',
    questionCount: 500,
    trainerHref: '/prince2-foundation',
    relatedSlugs: ['scrum', 'fiae', 'wirtschaftsfachwirt'],
    sampleQuestions: [
      {
        q: 'Welche 7 Prinzipien definiert PRINCE2?',
        a: 'Fortlaufende geschäftliche Rechtfertigung, Lernen aus Erfahrung, Definierte Rollen & Verantwortlichkeiten, Steuern über Managementphasen, Steuern nach dem Ausnahmeprinzip, Produktorientierung, Anpassung an die Projektumgebung.',
      },
      {
        q: 'Wer trägt im PRINCE2-Projekt die letzte Verantwortung für den Projekterfolg?',
        a: 'Der Executive im Lenkungsausschuss (Project Board). Er sichert die geschäftliche Rechtfertigung über die gesamte Projektlaufzeit.',
      },
      {
        q: 'Was beschreibt das Thema „Business Case" in PRINCE2?',
        a: 'Es dokumentiert die Begründung, den erwarteten Nutzen und die Wirtschaftlichkeit des Projekts. Es ist die Grundlage für Start, Fortführung oder Abbruch.',
      },
      {
        q: 'Welche 7 Prozesse umfasst PRINCE2?',
        a: 'Vorbereiten eines Projekts (SU), Lenken eines Projekts (DP), Initiieren eines Projekts (IP), Steuern einer Phase (CS), Managen einer Produktlieferung (MP), Managen eines Phasenübergangs (SB), Abschließen eines Projekts (CP).',
      },
      {
        q: 'Was ist ein „Management Stage" in PRINCE2?',
        a: 'Ein vom Projektmanager geleiteter Abschnitt, der mit einer formalen Entscheidung des Project Boards beginnt und endet (Go/No-Go). Sie sichert Steuerbarkeit nach dem Ausnahmeprinzip.',
      },
      {
        q: 'Was unterscheidet die PRINCE2-Practitioner-Prüfung von Foundation?',
        a: 'Practitioner prüft die Anwendung in realen Szenarien (Objective Testing, 68 Fragen, 150 Min., Pass-Score 55 %); Foundation prüft das Verständnis der Methode (60 MC-Fragen, 60 Min., Pass-Score 55 %).',
      },
      {
        q: 'Welche Toleranzen können in PRINCE2 gesetzt werden?',
        a: 'Sechs Toleranzbereiche: Zeit, Kosten, Qualität, Umfang, Risiko und Nutzen. Sie definieren den Spielraum, in dem ohne Eskalation gearbeitet werden darf.',
      },
    ],
    faqs: [
      {
        q: 'Welche PRINCE2-Edition deckt ExamFit ab?',
        a: 'ExamFit deckt PRINCE2 6th und 7th Edition ab. Du kannst die Variante in den Lerneinstellungen wählen; alle Fragen sind je Edition validiert.',
      },
      {
        q: 'Wie viele PRINCE2-Fragen kann ich üben?',
        a: 'Mehr als 500 Musterfragen für Foundation und Practitioner – alle mit Lösungen, Erklärungen und KI-Coach.',
      },
      {
        q: 'Gibt es eine Practitioner-Simulation?',
        a: 'Ja, ExamFit bietet eine vollständige Practitioner-Simulation mit 68 Objective-Testing-Fragen, 150 Minuten Bearbeitungszeit und detaillierter Auswertung.',
      },
    ],
  },
  {
    slug: 'industriekauffrau',
    title: 'Prüfungsfragen Industriekauffrau / Industriekaufmann (IHK) – Musterfragen | ExamFit',
    h1: 'Prüfung Industriekauffrau / Industriekaufmann – Musterfragen mit Lösungen',
    tagline: 'Über 1.200 prüfungsnahe Fragen für die IHK-Abschlussprüfung Teil 1 + 2.',
    metaDescription:
      'IHK-Prüfungsfragen Industriekauffrau & Industriekaufmann mit Lösungen: Geschäftsprozesse, Kaufmännische Steuerung, WiSo. Über 1.200 Musterfragen bei ExamFit.',
    intro:
      'ExamFit trainiert Auszubildende und Umschüler auf die IHK-Abschlussprüfung Industriekauffrau / Industriekaufmann (Teil 1 + Teil 2). Alle Musterfragen orientieren sich am gültigen Rahmenlehrplan (Verordnung 2002) und decken die Prüfungsbereiche Geschäftsprozesse, Kaufmännische Steuerung und Kontrolle, Wirtschafts- und Sozialkunde sowie das Fachgespräch ab.',
    questionCount: 1200,
    trainerHref: '/berufe/industriekaufmann',
    relatedSlugs: ['bankkauffrau', 'wirtschaftsfachwirt', 'bilanzbuchhalter'],
    sampleQuestions: [
      {
        q: 'Was ist der Unterschied zwischen Skonto und Rabatt?',
        a: 'Rabatt ist ein Preisnachlass auf den Listenpreis (z. B. Mengenrabatt). Skonto ist ein Nachlass für schnelle Zahlung innerhalb einer Skontofrist und wird vom Rechnungsbetrag abgezogen.',
      },
      {
        q: 'Wie berechnet sich der Bestellpunkt im Lager?',
        a: 'Bestellpunkt = (Tagesverbrauch × Wiederbeschaffungszeit) + Mindestbestand. Er löst eine Bestellung aus, bevor der Mindestbestand unterschritten wird.',
      },
      {
        q: 'Was bedeutet ABC-Analyse in der Materialwirtschaft?',
        a: 'Eine Klassifikation nach Wertanteil: A-Güter (~80 % Wert, ~20 % Menge), B-Güter (mittel), C-Güter (geringer Wertanteil, große Menge). Steuert Beschaffungsstrategie und Lagerintensität.',
      },
      {
        q: 'Welche Aufgaben hat der Betriebsrat nach § 87 BetrVG?',
        a: 'Der Betriebsrat hat erzwingbare Mitbestimmungsrechte u. a. bei Arbeitszeit, Urlaubsregelung, betrieblicher Lohngestaltung und Arbeitsschutz. Ohne seine Zustimmung sind entsprechende Regelungen unwirksam.',
      },
      {
        q: 'Was ist der Deckungsbeitrag?',
        a: 'Deckungsbeitrag = Umsatz – variable Kosten. Er deckt zunächst die Fixkosten; was darüber hinaus erwirtschaftet wird, ist Gewinn.',
      },
      {
        q: 'Wie unterscheiden sich Werkvertrag und Dienstvertrag?',
        a: 'Beim Werkvertrag wird ein konkreter Erfolg geschuldet (§ 631 BGB), beim Dienstvertrag nur das Tätigwerden (§ 611 BGB). Beispiel: Hausbau = Werkvertrag, Arztbehandlung = Dienstvertrag.',
      },
      {
        q: 'Was ist eine Inventur und welche Verfahren gibt es?',
        a: 'Inventur ist die mengen- und wertmäßige Erfassung aller Vermögenswerte zum Stichtag. Verfahren: Stichtagsinventur, zeitversetzte Inventur, permanente Inventur und Stichprobeninventur.',
      },
      {
        q: 'Welche drei Phasen umfasst die Personalbeschaffung?',
        a: 'Personalbedarfsplanung, Personalsuche (intern/extern) und Personalauswahl (Bewerbung, Interview, Eignungsdiagnostik, Vertragsabschluss).',
      },
    ],
    faqs: [
      {
        q: 'Deckt ExamFit beide IHK-Prüfungsteile ab?',
        a: 'Ja, sowohl Teil 1 (Geschäftsprozesse) als auch Teil 2 (Kaufmännische Steuerung, WiSo, Fachgespräch) sind vollständig abgedeckt.',
      },
      {
        q: 'Kann ich ein mündliches Fachgespräch simulieren?',
        a: 'Ja, ExamFit bietet einen Oral-Exam-Trainer mit KI-Prüfer für das Fachgespräch der Industriekaufleute.',
      },
    ],
  },
  {
    slug: 'bankkauffrau',
    title: 'Prüfungsfragen Bankkaufmann / Bankkauffrau (IHK) – Musterfragen mit Lösungen | ExamFit',
    h1: 'Bankkaufmann / Bankkauffrau Prüfungsfragen – IHK-Vorbereitung',
    tagline: 'Über 900 IHK-Musterfragen für die Bankkaufleute-Abschlussprüfung.',
    metaDescription:
      'IHK-Prüfungsfragen Bankkaufmann & Bankkauffrau mit Lösungen: Kontoführung, Geld- und Vermögensanlage, Kredite, WiSo. Über 900 Musterfragen bei ExamFit.',
    intro:
      'ExamFit bereitet dich auf die IHK-Abschlussprüfung Bankkaufmann / Bankkauffrau vor – mit Fragen zu Kontoführung & Zahlungsverkehr, Geld- und Vermögensanlage, Kreditgeschäft sowie Wirtschafts- und Sozialkunde. Inklusive Fallaufgaben und mündlichem Kundenberatungsgespräch.',
    questionCount: 900,
    trainerHref: '/berufe/bankkaufmann',
    relatedSlugs: ['industriekauffrau', 'bilanzbuchhalter', 'wirtschaftsfachwirt'],
    sampleQuestions: [
      {
        q: 'Was ist der Unterschied zwischen Sollzins und Effektivzins bei einem Kredit?',
        a: 'Der Sollzins ist der reine Zinssatz auf die Kreditsumme. Der Effektivzins enthält zusätzlich Bearbeitungsentgelte, Zinszahlungstermine und Restschuldversicherung – er ist daher die Vergleichsgröße nach PAngV.',
      },
      {
        q: 'Welche drei Anlagezielkonflikte definiert das magische Dreieck?',
        a: 'Rentabilität, Sicherheit und Liquidität (Verfügbarkeit). Eine gleichzeitige Maximierung aller drei Ziele ist nicht möglich – die Bank muss kundenindividuell gewichten.',
      },
      {
        q: 'Was ist eine Bürgschaft im Sinne des § 765 BGB?',
        a: 'Ein einseitig verpflichtender Vertrag, in dem sich der Bürge gegenüber dem Gläubiger verpflichtet, für die Erfüllung der Verbindlichkeit eines Dritten einzustehen. Schriftform ist Pflicht (§ 766 BGB).',
      },
      {
        q: 'Was bedeutet SEPA und welche Lastschriftarten gibt es?',
        a: 'SEPA (Single Euro Payments Area) vereinheitlicht den Euro-Zahlungsverkehr. Lastschriftarten: SEPA-Basis-Lastschrift (Core, mit 8-Wochen-Rückgaberecht) und SEPA-Firmen-Lastschrift (B2B, ohne Rückgaberecht).',
      },
      {
        q: 'Welche Kundengruppen unterscheidet MiFID II?',
        a: 'Privatkunden, professionelle Kunden und geeignete Gegenparteien. Die Einstufung bestimmt Aufklärungs-, Geeignetheits- und Dokumentationspflichten der Bank.',
      },
      {
        q: 'Was ist der Beleihungswert einer Immobilie?',
        a: 'Der nachhaltig erzielbare Marktwert nach § 16 PfandBG – meist 70–80 % des Verkehrswerts. Er bildet die Basis für die Kreditvergabe in der Immobilienfinanzierung.',
      },
      {
        q: 'Wie funktioniert ein Annuitätendarlehen?',
        a: 'Der Kreditnehmer zahlt eine konstante Rate (Annuität) aus Zins und Tilgung. Mit fortschreitender Laufzeit sinkt der Zinsanteil und der Tilgungsanteil steigt – die Restschuld wird planmäßig getilgt.',
      },
    ],
    faqs: [
      {
        q: 'Sind die Fragen für Bankkaufleute auf dem aktuellen Stand?',
        a: 'Ja, ExamFit aktualisiert die Fragen laufend nach BaFin-Vorgaben, neuer Rechtsprechung und Änderungen im Bankenaufsichtsrecht (MaRisk, MiFID II, WpHG).',
      },
      {
        q: 'Gibt es Übungen für das Kundenberatungsgespräch?',
        a: 'Ja, der Oral-Exam-Trainer simuliert das mündliche Kundenberatungsgespräch mit einem KI-Kunden, der realistisch nachfragt.',
      },
    ],
  },
  {
    slug: 'fiae',
    title: 'Prüfungsfragen Fachinformatiker Anwendungsentwicklung (FIAE) – Musterfragen | ExamFit',
    h1: 'Fachinformatiker Anwendungsentwicklung – Prüfungsfragen mit Lösungen',
    tagline: 'Über 1.100 Musterfragen für die IHK-Abschlussprüfung FIAE.',
    metaDescription:
      'IHK-Prüfungsfragen Fachinformatiker Anwendungsentwicklung mit Lösungen: Anwendungsentwicklung, WiSo, Projektarbeit. Über 1.100 Musterfragen bei ExamFit.',
    intro:
      'ExamFit deckt die gestreckte Abschlussprüfung Fachinformatiker Anwendungsentwicklung (Teil 1 + 2) vollständig ab. Inhalte: Einrichten eines IT-gestützten Arbeitsplatzes, Planen & Konzipieren eines Softwareprodukts, Entwickeln & Bereitstellen, WiSo sowie Projektarbeit & Fachgespräch.',
    questionCount: 1100,
    trainerHref: '/fachinformatiker-ae-pruefungsvorbereitung',
    relatedSlugs: ['scrum', 'industriekauffrau', 'prince2'],
    sampleQuestions: [
      {
        q: 'Was unterscheidet eine SQL-INNER-JOIN von einer LEFT-JOIN?',
        a: 'INNER JOIN liefert nur Zeilen, für die in beiden Tabellen ein Match existiert. LEFT JOIN liefert zusätzlich alle Zeilen der linken Tabelle – ohne Match werden die rechten Spalten mit NULL aufgefüllt.',
      },
      {
        q: 'Was beschreibt das Prinzip der Kapselung in der objektorientierten Programmierung?',
        a: 'Daten und zugehörige Methoden einer Klasse werden zu einer Einheit zusammengefasst, der direkte Zugriff auf interne Daten wird über Sichtbarkeiten (private, protected) verhindert. Zugriff erfolgt nur über definierte Schnittstellen (Getter/Setter).',
      },
      {
        q: 'Wofür steht das Akronym REST in Webservices?',
        a: 'Representational State Transfer – ein Architekturstil für stateless HTTP-APIs, der auf Ressourcen, eindeutigen URIs und Standard-HTTP-Verben (GET, POST, PUT, DELETE) basiert.',
      },
      {
        q: 'Was ist ein Deadlock und wie kann er vermieden werden?',
        a: 'Ein Deadlock ist eine zyklische Wartebedingung zwischen Prozessen, die jeweils Ressourcen halten und auf Ressourcen des anderen warten. Vermeidung: feste Ressourcenreihenfolge, Timeouts oder Vermeidung von Hold-and-Wait (z. B. alle Sperren auf einmal anfordern).',
      },
      {
        q: 'Welche Normalformen kennt die relationale Datenbanktheorie typischerweise in der IHK-Prüfung?',
        a: '1. NF (atomare Werte), 2. NF (volle funktionale Abhängigkeit vom Schlüssel), 3. NF (keine transitiven Abhängigkeiten). Boyce-Codd-NF und höhere werden gelegentlich abgefragt.',
      },
      {
        q: 'Was leistet eine Versionsverwaltung wie Git?',
        a: 'Sie speichert Code-Stände als Commits, ermöglicht parallele Entwicklung in Branches, Merge und Konfliktauflösung sowie Nachvollziehbarkeit und Rollback – ohne Codeüberschneidungen zwischen Entwicklern.',
      },
      {
        q: 'Was ist der Unterschied zwischen synchroner und asynchroner Programmierung?',
        a: 'Synchron blockiert die Ausführung bis ein Ergebnis vorliegt. Asynchron startet eine Operation und führt parallel anderen Code aus – das Ergebnis kommt per Callback, Promise oder await.',
      },
    ],
    faqs: [
      {
        q: 'Deckt ExamFit auch die Projektarbeit für FIAE ab?',
        a: 'Ja, ExamFit hat einen eigenen Bereich für Projektantrag, Projektdokumentation und das anschließende Fachgespräch mit KI-Prüfer-Simulation.',
      },
      {
        q: 'Wird Scrum auch im FIAE-Kontext geprüft?',
        a: 'Ja, agile Methoden (insbesondere Scrum und Kanban) sind Pflichtinhalt – siehe auch unsere Scrum-Musterfragen.',
      },
    ],
  },
  {
    slug: 'aevo',
    title: 'AEVO Prüfungsfragen – Schriftlich, Praktisch & Fachgespräch | ExamFit',
    h1: 'AEVO Prüfungsfragen – Musterfragen für die Ausbildereignungsprüfung',
    tagline: 'Über 700 prüfungsnahe Fragen für AEVO / AdA (IHK & HWK).',
    metaDescription:
      'AEVO Prüfungsfragen mit Lösungen üben: Handlungsfelder 1–4, schriftliche Prüfung, praktische Prüfung und Fachgespräch. Über 700 Musterfragen bei ExamFit.',
    intro:
      'ExamFit bereitet dich vollständig auf die AEVO/AdA-Prüfung der IHK und HWK vor: Handlungsfelder 1 (Ausbildungsvoraussetzungen prüfen, Ausbildung planen), 2 (Ausbildung vorbereiten, Mitwirken bei der Einstellung), 3 (Ausbildung durchführen) und 4 (Ausbildung abschließen). Inklusive Vier-Stufen-Methode, Lernzieltaxonomie und Konzept für die praktische Prüfung.',
    questionCount: 700,
    trainerHref: '/aevo-pruefungsvorbereitung',
    relatedSlugs: ['industriekauffrau', 'wirtschaftsfachwirt'],
    sampleQuestions: [
      {
        q: 'Welche Voraussetzungen muss ein Ausbilder nach BBiG erfüllen?',
        a: 'Persönliche Eignung (§ 29 BBiG: keine ausschließenden Tatsachen) und fachliche Eignung (§ 30 BBiG: Berufsabschluss + berufs- und arbeitspädagogische Kenntnisse, in der Regel durch AEVO nachgewiesen).',
      },
      {
        q: 'Was ist die Vier-Stufen-Methode?',
        a: 'Eine ausbildungsdidaktische Methode: 1. Vorbereiten, 2. Vormachen & Erklären, 3. Nachmachen & Erklären lassen, 4. Üben & Festigen. Geeignet für klar strukturierte, manuelle Tätigkeiten.',
      },
      {
        q: 'Welche Lernzielbereiche unterscheidet Bloom?',
        a: 'Kognitiv (Wissen, Verstehen, Anwenden, Analysieren, Bewerten, Erschaffen), affektiv (Einstellungen, Werte) und psychomotorisch (Bewegungsabläufe, Fertigkeiten).',
      },
      {
        q: 'Welche Rechtsgrundlage regelt die Berufsausbildung in Deutschland?',
        a: 'Das Berufsbildungsgesetz (BBiG) und die Handwerksordnung (HwO) sowie die jeweilige Ausbildungsverordnung des Berufs (z. B. Verordnung Industriekaufleute 2002).',
      },
      {
        q: 'Was ist der Unterschied zwischen Probezeit und Kündigungsfrist im Ausbildungsverhältnis?',
        a: 'Probezeit (§ 20 BBiG) dauert 1–4 Monate; während dieser Zeit ist Kündigung jederzeit ohne Frist möglich. Danach kann der Auszubildende mit 4 Wochen Frist kündigen, der Ausbildende nur aus wichtigem Grund (§ 22 BBiG).',
      },
      {
        q: 'Wie kann die Ausbildungsreife eines Bewerbers geprüft werden?',
        a: 'Über Bewerbungsunterlagen, strukturierte Interviews, Eignungstests (z. B. allgemeinbildende, berufsspezifische Tests), Assessment-Center, Schnuppertage oder Einstellungspraktika.',
      },
      {
        q: 'Was beinhaltet die praktische AEVO-Prüfung?',
        a: 'Eine 15-minütige Präsentation oder eine praktische Durchführung einer Ausbildungssituation (z. B. 4-Stufen-Methode oder Lehrgespräch), gefolgt von einem 15-minütigen Fachgespräch.',
      },
    ],
    faqs: [
      {
        q: 'Gilt die AEVO bei IHK und HWK gleichermaßen?',
        a: 'Ja, die Ausbilder-Eignungsverordnung (AEVO) ist bundesweit identisch geregelt. Die Prüfung wird von IHK oder HWK abgenommen, der Schein ist gegenseitig anerkannt.',
      },
      {
        q: 'Wie lange dauert die schriftliche AEVO-Prüfung?',
        a: 'In der Regel 180 Minuten (3 Stunden) mit fallbezogenen Aufgaben zu allen 4 Handlungsfeldern.',
      },
    ],
  },
  {
    slug: 'bilanzbuchhalter',
    title: 'Bilanzbuchhalter Prüfungsfragen – Musterfragen mit Lösungen | ExamFit',
    h1: 'Bilanzbuchhalter Prüfungsfragen – IHK-Fortbildung',
    tagline: 'Über 800 Musterfragen für die Bilanzbuchhalter-Prüfung der IHK.',
    metaDescription:
      'Bilanzbuchhalter Prüfungsfragen mit Lösungen: Jahresabschluss, Steuern, Kosten- und Leistungsrechnung, Finanzwirtschaft. Über 800 Musterfragen bei ExamFit.',
    intro:
      'ExamFit deckt die Geprüfter Bilanzbuchhalter / Geprüfte Bilanzbuchhalterin-Prüfung der IHK vollständig ab: Jahresabschluss nach HGB und IFRS, Steuerrecht, Kosten- und Leistungsrechnung, Finanzwirtschaft, Berichterstattung & interne Kontrollsysteme.',
    questionCount: 800,
    trainerHref: '/bilanzbuchhalter-pruefungsvorbereitung',
    relatedSlugs: ['industriekauffrau', 'wirtschaftsfachwirt', 'bankkauffrau'],
    sampleQuestions: [
      {
        q: 'Was ist der Unterschied zwischen Aufwand und Auszahlung?',
        a: 'Auszahlung ist ein realer Geldabfluss (liquiditätswirksam). Aufwand ist ein periodenbezogener Werteverzehr in der GuV. Beispiel: Eine Anschaffung im Januar = Auszahlung, die jährliche Abschreibung darüber = Aufwand.',
      },
      {
        q: 'Welche Bewertungsgrundsätze gelten nach § 252 HGB?',
        a: 'Unternehmensfortführung, Einzelbewertung, Vorsicht (Realisations-/Imparitätsprinzip), Periodenabgrenzung, Stetigkeit, Bilanzidentität, sachliche und zeitliche Abgrenzung.',
      },
      {
        q: 'Wie unterscheiden sich planmäßige und außerplanmäßige Abschreibung?',
        a: 'Planmäßig verteilt die Anschaffungskosten über die Nutzungsdauer (linear, degressiv, leistungsbezogen). Außerplanmäßig erfolgt bei dauerhafter Wertminderung (Niederstwertprinzip, § 253 HGB).',
      },
      {
        q: 'Was ist eine latente Steuer?',
        a: 'Eine Steuerabgrenzung für Differenzen zwischen Handelsbilanz und Steuerbilanz, die sich in der Zukunft umkehren (temporary differences). Aktive latente Steuern entstehen bei zukünftiger Steuerentlastung, passive bei Steuerbelastung.',
      },
      {
        q: 'Welche Bestandteile hat ein Jahresabschluss nach § 242 HGB?',
        a: 'Bilanz und Gewinn- und Verlustrechnung; für Kapitalgesellschaften zusätzlich Anhang (§ 264) und ggf. Lagebericht.',
      },
      {
        q: 'Was ist ein Cashflow aus laufender Geschäftstätigkeit?',
        a: 'Der Mittelzufluss/-abfluss aus dem operativen Geschäft – Ausgangspunkt: Jahresergebnis, korrigiert um nicht zahlungswirksame Posten (Abschreibungen, Rückstellungsänderungen) und Veränderungen des Working Capital.',
      },
    ],
    faqs: [
      {
        q: 'Welche Prüfungsteile umfasst die Bilanzbuchhalter-Prüfung?',
        a: 'Vier schriftliche Teile (jeweils Klausur 90–180 Min.): Geschäftsvorfälle erfassen, Jahresabschluss erstellen, Steuern, Auswertung des Jahresabschlusses; danach mündliche Präsentation + Fachgespräch.',
      },
    ],
  },
  {
    slug: 'wirtschaftsfachwirt',
    title: 'Wirtschaftsfachwirt Prüfungsfragen – Musterfragen mit Lösungen | ExamFit',
    h1: 'Wirtschaftsfachwirt Prüfungsfragen – IHK-Fortbildung',
    tagline: 'Über 900 Musterfragen für Geprüfter Wirtschaftsfachwirt / Wirtschaftsfachwirtin.',
    metaDescription:
      'Wirtschaftsfachwirt Prüfungsfragen mit Lösungen: VWL, BWL, Recht & Steuern, Unternehmensführung, Marketing, Personal. Über 900 Musterfragen bei ExamFit.',
    intro:
      'ExamFit bereitet auf die IHK-Prüfung Geprüfter Wirtschaftsfachwirt / Geprüfte Wirtschaftsfachwirtin vor. Beide Prüfungsteile (wirtschaftsbezogene Qualifikationen + handlungsspezifische Qualifikationen) sind vollständig mit Übungsfragen, Fallaufgaben und Lösungen abgedeckt.',
    questionCount: 900,
    trainerHref: '/wirtschaftsfachwirt',
    relatedSlugs: ['industriekauffrau', 'bilanzbuchhalter', 'bankkauffrau'],
    sampleQuestions: [
      {
        q: 'Was beschreibt die Preiselastizität der Nachfrage?',
        a: 'Das Verhältnis der prozentualen Mengenänderung zur prozentualen Preisänderung. Elastisch (|E|>1) bedeutet starke Reaktion, unelastisch (|E|<1) geringe Reaktion – wichtig für Preispolitik.',
      },
      {
        q: 'Welche Rechtsformen einer Kapitalgesellschaft gibt es in Deutschland?',
        a: 'GmbH, UG (haftungsbeschränkt), AG, KGaA, SE (Europäische Aktiengesellschaft). Sie haften ausschließlich mit dem Gesellschaftsvermögen.',
      },
      {
        q: 'Was misst der ROI (Return on Investment)?',
        a: 'ROI = (Gewinn / investiertes Kapital) × 100. Er zeigt die Verzinsung des eingesetzten Kapitals und ist eine zentrale Kennzahl der Rentabilitätsanalyse.',
      },
      {
        q: 'Welche Marketing-Instrumente fasst der klassische 4-P-Mix zusammen?',
        a: 'Product (Produktpolitik), Price (Preispolitik), Place (Distributionspolitik), Promotion (Kommunikationspolitik).',
      },
      {
        q: 'Was sind die Kondratieff-Zyklen in der VWL?',
        a: 'Lange Konjunkturwellen (~40–60 Jahre), ausgelöst durch Basisinnovationen (z. B. Dampfmaschine, Elektrizität, Computer, Digitalisierung).',
      },
    ],
    faqs: [
      {
        q: 'Wie viele Fragen umfasst der Wirtschaftsfachwirt-Trainer?',
        a: 'Über 900 Fragen für beide Prüfungsteile inkl. wirtschaftsbezogener und handlungsspezifischer Qualifikationen.',
      },
    ],
  },
  {
    slug: 'maurer',
    title: 'Prüfungsfragen Maurer / Maurerin – HWK Gesellenprüfung Musterfragen | ExamFit',
    h1: 'Maurer Prüfungsfragen – HWK Gesellenprüfung Teil 1 & 2',
    tagline: 'Über 600 prüfungsnahe Musterfragen für die Maurer-Gesellenprüfung.',
    metaDescription:
      'Maurer Prüfungsfragen mit Lösungen: Baukonstruktion, Bauphysik, Mauerwerk, Putz, WiSo. Über 600 HWK-Musterfragen für Teil 1 und Teil 2 bei ExamFit.',
    intro:
      'ExamFit deckt die HWK-Gesellenprüfung Maurer / Maurerin in beiden Teilen ab. Inhalte: Baustoffkunde, Mauerwerk und Verbände, Wärmedämmung und Bauphysik, Bewehrung, Schalung, Putz- und Estricharbeiten sowie WiSo.',
    questionCount: 600,
    trainerHref: '/berufe/maurer',
    relatedSlugs: ['industriekauffrau', 'aevo'],
    sampleQuestions: [
      {
        q: 'Welche Mauerwerksverbände kennt der Maurer und wann werden sie eingesetzt?',
        a: 'Läuferverband (halbsteinige Wände), Binderverband (Sichtmauerwerk), Blockverband, Kreuzverband und Gotischer Verband (klassisches Sichtmauerwerk). Auswahl nach statischen und gestalterischen Anforderungen.',
      },
      {
        q: 'Was ist der Unterschied zwischen Mörtelgruppe MG II und MG III?',
        a: 'MG II ist ein Kalkzement-Normalmauermörtel für mittlere Beanspruchung. MG III ist Zementmörtel für hohe Beanspruchung, insbesondere für statisch belastete und feuchtegefährdete Bauteile (z. B. Kellergeschoss).',
      },
      {
        q: 'Wofür steht der U-Wert in der Bauphysik?',
        a: 'Wärmedurchgangskoeffizient in W/(m²·K). Er gibt an, wie viel Wärme pro Quadratmeter durch ein Bauteil bei 1 K Temperaturdifferenz fließt – je kleiner, desto besser die Dämmwirkung.',
      },
      {
        q: 'Welche Funktionen erfüllt eine Bewehrung im Stahlbeton?',
        a: 'Sie nimmt Zugspannungen auf, die Beton selbst kaum aushält. Beton überträgt Druckkräfte, Stahl die Zugkräfte – zusammen ergibt das den Verbundwerkstoff Stahlbeton.',
      },
      {
        q: 'Was ist eine horizontale Sperrschicht und wozu dient sie?',
        a: 'Eine wasserundurchlässige Schicht im Mauerwerk (z. B. Bitumenbahn, KMB), die aufsteigende Feuchtigkeit aus dem Erdreich verhindert. Pflicht im Sockelbereich nach DIN 18533.',
      },
      {
        q: 'Welche Estricharten gibt es?',
        a: 'Zementestrich (CT), Calciumsulfatestrich (CA/Anhydrit), Magnesiaestrich (MA), Gussasphaltestrich (AS), Kunstharzestrich (SR). Wahl nach Belastung, Feuchte und Folgebelag.',
      },
    ],
    faqs: [
      {
        q: 'Sind die Fragen am aktuellen Rahmenlehrplan ausgerichtet?',
        a: 'Ja, ExamFit folgt der gültigen Verordnung über die Berufsausbildung im Maurerhandwerk und den HWK-Prüfungsanforderungen.',
      },
    ],
  },
  {
    slug: 'bwl',
    title: 'BWL Klausurfragen – Musterfragen mit Lösungen für Studium & Klausur | ExamFit',
    h1: 'BWL Klausurfragen – Musterfragen für Studierende',
    tagline: 'Über 1.000 Klausurfragen aus BWL-Grundlagen und Vertiefung.',
    metaDescription:
      'BWL Klausurfragen mit Lösungen: ABWL, Rechnungswesen, Marketing, Personal, Investition & Finanzierung. Über 1.000 Musterfragen für die Klausur bei ExamFit.',
    intro:
      'ExamFit unterstützt Studierende der BWL und Wirtschaftswissenschaften mit Klausurfragen aus ABWL, internem & externem Rechnungswesen, Marketing, Personal, Organisation, Investition und Finanzierung. Alle Fragen sind klausurnah formuliert und enthalten musterhafte Lösungen.',
    questionCount: 1000,
    trainerHref: '/bwl-klausur',
    relatedSlugs: ['bilanzbuchhalter', 'wirtschaftsfachwirt', 'industriekauffrau'],
    sampleQuestions: [
      {
        q: 'Was sind die drei Grundprinzipien der doppelten Buchführung?',
        a: 'Jeder Geschäftsvorfall wird auf mindestens zwei Konten gebucht (Soll und Haben), der Erfolg wird sowohl über Bestandsvergleich (Bilanz) als auch über die GuV ermittelt, und beide Wege müssen denselben Gewinn ergeben.',
      },
      {
        q: 'Wie berechnet sich der Kapitalwert (NPV) einer Investition?',
        a: 'NPV = Σ (Cashflow_t / (1 + i)^t) − Anschaffungsauszahlung. Positiver NPV = Investition vorteilhaft, negativer NPV = nicht vorteilhaft.',
      },
      {
        q: 'Was beschreibt Porters Five-Forces-Modell?',
        a: 'Es analysiert die Wettbewerbsintensität einer Branche anhand von 5 Kräften: Verhandlungsmacht der Lieferanten, Verhandlungsmacht der Kunden, Bedrohung durch neue Wettbewerber, Bedrohung durch Substitute und Rivalität unter Wettbewerbern.',
      },
      {
        q: 'Was ist der Break-Even-Point?',
        a: 'Der Punkt, an dem Erlöse die gesamten Kosten decken (Gewinn = 0). Berechnung: Break-Even-Menge = Fixkosten / (Preis − variable Stückkosten).',
      },
      {
        q: 'Was sind transaktionskostentheoretische Argumente für vertikale Integration?',
        a: 'Hohe spezifische Investitionen, opportunistisches Verhalten, häufige Transaktionen und Unsicherheit führen zu hohen Marktkosten – interne Abwicklung (Make) wird dann effizienter als Marktbezug (Buy).',
      },
    ],
    faqs: [
      {
        q: 'Decken die Fragen Bachelor- und Master-Niveau ab?',
        a: 'Ja, ExamFit bietet Fragen für ABWL-Grundlagen (Bachelor) und vertiefende Klausuren in Master-Veranstaltungen.',
      },
    ],
  },
];

export function getExamTopicBySlug(slug: string): ExamTopic | undefined {
  const t = EXAM_TOPICS.find((t) => t.slug === slug);
  if (!t) return undefined;
  const kw = TOPIC_KEYWORDS[slug];
  // Merge in keyword/synonym data without mutating original.
  return {
    ...t,
    keywords: t.keywords ?? kw?.keywords,
    synonyms: t.synonyms ?? kw?.synonyms,
  };
}

/** Liefert verwandte Topics — bevorzugt explizite relatedSlugs, sonst alle anderen Topics. */
export function getRelatedTopics(slug: string, limit = 3): ExamTopic[] {
  const t = EXAM_TOPICS.find((x) => x.slug === slug);
  const ids = new Set<string>(t?.relatedSlugs ?? []);
  const out: ExamTopic[] = [];
  for (const id of ids) {
    const found = EXAM_TOPICS.find((x) => x.slug === id);
    if (found) out.push(found);
  }
  if (out.length < limit) {
    for (const x of EXAM_TOPICS) {
      if (x.slug === slug) continue;
      if (out.find((y) => y.slug === x.slug)) continue;
      out.push(x);
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}

