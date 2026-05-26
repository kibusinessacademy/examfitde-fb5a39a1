/**
 * HR Longtail SEO Seed — programmable Pages für /hr/:slug.
 * Jede Seite hat eigenen Pre-Filled Calculator-Context + eigene Frage.
 */
import type { ContractType, EmploymentRole } from "./deadline-rules";

export interface LongtailPage {
  slug: string;
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
  preset: {
    role: EmploymentRole;
    contract: ContractType;
    presetTenureMonths?: number;
  };
  faq: { q: string; a: string }[];
  relatedSlugs: string[];
}

export const LONGTAIL_PAGES: LongtailPage[] = [
  {
    slug: "kuendigungsfrist-probezeit",
    title: "Kündigungsfrist Probezeit — §622 Abs. 3 BGB richtig anwenden",
    metaDescription: "Welche Kündigungsfrist gilt in der Probezeit? 2 Wochen ohne Termin nach §622 Abs. 3 BGB. Jetzt rechtssicher berechnen.",
    h1: "Kündigungsfrist in der Probezeit",
    intro: "In der gesetzlichen Probezeit (maximal 6 Monate) gilt für beide Seiten eine Kündigungsfrist von 2 Wochen — ohne festen Beendigungstermin.",
    preset: { role: "arbeitgeber", contract: "probezeit", presetTenureMonths: 3 },
    faq: [
      { q: "Wie lang ist die Probezeit höchstens?", a: "Höchstens 6 Monate (§622 Abs. 3 BGB). Tarifverträge können abweichen." },
      { q: "Gilt die 2-Wochen-Frist für Arbeitgeber und Arbeitnehmer?", a: "Ja, beide Seiten können in der Probezeit mit 2 Wochen Frist ohne Termin kündigen." },
      { q: "Kann die Probezeit verkürzt werden?", a: "Ja, im Arbeitsvertrag oder Tarifvertrag — eine Verlängerung über 6 Monate hinaus ist unzulässig." },
    ],
    relatedSlugs: ["kuendigungsfrist-2-jahre", "fristlose-kuendigung-frist"],
  },
  {
    slug: "kuendigungsfrist-2-jahre",
    title: "Kündigungsfrist nach 2 Jahren — 1 Monat zum Monatsende",
    metaDescription: "Ab 2 Jahren Betriebszugehörigkeit gilt für Arbeitgeber 1 Monat Kündigungsfrist zum Monatsende. Jetzt mit Rechner prüfen.",
    h1: "Kündigungsfrist nach 2 Jahren Betriebszugehörigkeit",
    intro: "Nach 2 Jahren Betriebszugehörigkeit verlängert sich die Arbeitgeber-Kündigungsfrist auf 1 Monat zum Monatsende (§622 Abs. 2 Nr. 1 BGB).",
    preset: { role: "arbeitgeber", contract: "unbefristet", presetTenureMonths: 30 },
    faq: [
      { q: "Gilt diese Frist auch für den Arbeitnehmer?", a: "Nein. §622 Abs. 2 BGB verlängert die Frist nur für den Arbeitgeber. Der Arbeitnehmer bleibt — sofern arbeitsvertraglich nichts anderes vereinbart ist — bei der Grundfrist." },
      { q: "Wann beginnt die Frist?", a: "Mit dem Tag nach Zugang der Kündigungserklärung beim Empfänger." },
      { q: "Was passiert, wenn die Kündigung zu spät zugeht?", a: "Sie wirkt erst zum nächsten möglichen Termin — die Kündigung wird nicht unwirksam, sondern verschoben." },
    ],
    relatedSlugs: ["kuendigungsfrist-5-jahre", "kuendigungsfrist-probezeit"],
  },
  {
    slug: "kuendigungsfrist-5-jahre",
    title: "Kündigungsfrist nach 5 Jahren — 2 Monate zum Monatsende",
    metaDescription: "Ab 5 Jahren Betriebszugehörigkeit gilt 2 Monate Kündigungsfrist zum Monatsende (§622 Abs. 2 Nr. 2 BGB).",
    h1: "Kündigungsfrist nach 5 Jahren",
    intro: "Ab 5 Jahren beträgt die Arbeitgeber-Kündigungsfrist 2 Monate zum Monatsende.",
    preset: { role: "arbeitgeber", contract: "unbefristet", presetTenureMonths: 66 },
    faq: [
      { q: "Welcher Paragraph regelt das?", a: "§622 Abs. 2 Nr. 2 BGB." },
      { q: "Werden Ausbildungszeiten angerechnet?", a: "Eine im Betrieb absolvierte Ausbildung zählt zur Betriebszugehörigkeit im Sinne des §622 Abs. 2 BGB." },
    ],
    relatedSlugs: ["kuendigungsfrist-2-jahre", "kuendigungsfrist-ausbildung"],
  },
  {
    slug: "kuendigungsfrist-ausbildung",
    title: "Kündigungsfrist Ausbildung — BBiG §22 für Azubis & Ausbilder",
    metaDescription: "Kündigung im Ausbildungsverhältnis: Probezeit jederzeit, danach nur aus wichtigem Grund. Azubi-Kündigung mit 4 Wochen Frist.",
    h1: "Kündigungsfrist im Ausbildungsverhältnis",
    intro: "Das Berufsbildungsgesetz (§22 BBiG) regelt die Kündigung von Ausbildungsverhältnissen abweichend vom BGB. In der Probezeit ist die Kündigung jederzeit möglich, danach gelten enge Voraussetzungen.",
    preset: { role: "arbeitnehmer", contract: "ausbildung_nach_probezeit", presetTenureMonths: 12 },
    faq: [
      { q: "Wie lang ist die Probezeit in der Ausbildung?", a: "Mindestens 1, höchstens 4 Monate (§20 BBiG)." },
      { q: "Kann der Ausbilder nach der Probezeit kündigen?", a: "Nur aus wichtigem Grund und ohne Einhaltung einer Frist (§22 Abs. 2 Nr. 1 BBiG)." },
      { q: "Welche Frist hat der Azubi nach der Probezeit?", a: "4 Wochen Frist — z. B. bei Aufgabe der Ausbildung oder Berufswechsel (§22 Abs. 2 Nr. 2 BBiG)." },
    ],
    relatedSlugs: ["kuendigungsfrist-probezeit", "fristlose-kuendigung-frist"],
  },
  {
    slug: "fristlose-kuendigung-frist",
    title: "Fristlose Kündigung — 2-Wochen-Frist nach §626 BGB",
    metaDescription: "Eine fristlose Kündigung muss innerhalb von 2 Wochen ab Kenntnis vom Kündigungsgrund erklärt werden (§626 Abs. 2 BGB).",
    h1: "Fristlose Kündigung — die 2-Wochen-Frist",
    intro: "Eine außerordentliche (fristlose) Kündigung nach §626 BGB ist nur wirksam, wenn sie innerhalb von 2 Wochen ab Kenntnis vom Kündigungsgrund ausgesprochen wird.",
    preset: { role: "arbeitgeber", contract: "unbefristet", presetTenureMonths: 36 },
    faq: [
      { q: "Wann beginnt die 2-Wochen-Frist?", a: "Mit positiver Kenntnis des Kündigungsberechtigten von den maßgebenden Tatsachen (§626 Abs. 2 S. 2 BGB)." },
      { q: "Was passiert bei Fristversäumung?", a: "Die fristlose Kündigung ist unwirksam. Eine ordentliche Kündigung kann weiterhin möglich sein." },
    ],
    relatedSlugs: ["betriebsrat-anhoerung-frist", "kuendigungsschutzklage-frist"],
  },
  {
    slug: "betriebsrat-anhoerung-frist",
    title: "Betriebsrat anhören — Fristen nach §102 BetrVG",
    metaDescription: "Vor jeder Kündigung muss der Betriebsrat angehört werden. Frist: 1 Woche bei ordentlichen, 3 Tage bei außerordentlichen Kündigungen.",
    h1: "Anhörung des Betriebsrats vor Kündigung",
    intro: "Ohne ordnungsgemäße Anhörung des Betriebsrats ist eine Kündigung nach §102 Abs. 1 S. 3 BetrVG unwirksam.",
    preset: { role: "arbeitgeber", contract: "unbefristet", presetTenureMonths: 30 },
    faq: [
      { q: "Welche Frist hat der Betriebsrat?", a: "1 Woche bei ordentlichen, 3 Tage bei außerordentlichen Kündigungen (§102 Abs. 2 BetrVG)." },
      { q: "Was passiert ohne Anhörung?", a: "Die Kündigung ist unwirksam — unabhängig vom Kündigungsgrund." },
    ],
    relatedSlugs: ["fristlose-kuendigung-frist", "kuendigungsschutzklage-frist"],
  },
  {
    slug: "kuendigungsschutzklage-frist",
    title: "Kündigungsschutzklage — 3-Wochen-Frist nach §4 KSchG",
    metaDescription: "Eine Kündigungsschutzklage muss innerhalb von 3 Wochen nach Zugang der Kündigung beim Arbeitsgericht eingereicht werden.",
    h1: "Frist für die Kündigungsschutzklage",
    intro: "Nach §4 KSchG muss eine Klage gegen die Wirksamkeit der Kündigung innerhalb von 3 Wochen nach Zugang erhoben werden — andernfalls gilt die Kündigung als wirksam (§7 KSchG).",
    preset: { role: "arbeitnehmer", contract: "unbefristet", presetTenureMonths: 36 },
    faq: [
      { q: "Wann beginnt die 3-Wochen-Frist?", a: "Mit Zugang der schriftlichen Kündigungserklärung beim Arbeitnehmer." },
      { q: "Was passiert bei Fristversäumung?", a: "Die Kündigung gilt als von Anfang an rechtswirksam (§7 KSchG) — eine nachträgliche Klagezulassung ist nur in engen Ausnahmen möglich." },
    ],
    relatedSlugs: ["fristlose-kuendigung-frist", "betriebsrat-anhoerung-frist"],
  },
];

export function getLongtailPage(slug: string): LongtailPage | undefined {
  return LONGTAIL_PAGES.find((p) => p.slug === slug);
}
