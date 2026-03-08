/**
 * PDF/Text Regulation Sectionizer
 *
 * Extracts structural elements from German Fortbildungs-/Prüfungsverordnungen:
 * - §-Paragraphs
 * - Exam parts (Teil I–IV)
 * - Handlungsbereiche
 * - Projektarbeit / Fachgespräch
 * - Zulassungsvoraussetzungen
 * - Gewichtung / Bestehensregelung
 */

export interface SectionizedResult {
  paragraphs: string[];
  exam_parts: string[];
  handlungsbereiche: string[];
  competency_areas: string[];
  project_component: boolean;
  oral_component: boolean;
  admission_hints: string[];
  pass_rule_hints: string[];
  weighting_hints: string[];
  legal_references: string[];
}

export function extractSections(text: string): SectionizedResult {
  const paragraphs = [...text.matchAll(/§\s*\d+[^\n]*/g)].map((p) => p[0].trim());

  const examParts = [...text.matchAll(/(?:prüfungs)?teil\s+[ivx\d]+[^\n]*/gi)].map((p) =>
    p[0].trim()
  );

  const handlungsbereiche = [
    ...text.matchAll(/handlungsbereich\s+[a-zäöüß0-9:–\-\s]+/gi),
  ].map((p) => p[0].trim());

  const competencyAreas = [
    ...text.matchAll(
      /(?:qualifikationsschwerpunkt|qualifikationsbereich|prüfungsbereich)\s+[a-zäöüß0-9:–\-\s]+/gi
    ),
  ].map((p) => p[0].trim());

  const project = /projektarbeit|projektprüfung|projektbezogene/i.test(text);
  const oral = /fachgespräch|mündliche\s+prüfung|mündliche\s+ergänzungsprüfung/i.test(text);

  const admissionHints = [
    ...text.matchAll(/(?:zulassung|zugelassen|voraussetzung)[^\n]*/gi),
  ].map((p) => p[0].trim());

  const passRuleHints = [
    ...text.matchAll(/(?:bestanden|bestehensregelung|besteht\s+die\s+prüfung)[^\n]*/gi),
  ].map((p) => p[0].trim());

  const weightingHints = [
    ...text.matchAll(/(?:gewichtung|prozent|vom\s+hundert|anteil)[^\n]*/gi),
  ].map((p) => p[0].trim());

  const legalReferences = [
    ...text.matchAll(/(?:verordnung|bbig|hwo|berufsbildungsgesetz|handwerksordnung)[^\n]*/gi),
  ].map((p) => p[0].trim());

  return {
    paragraphs,
    exam_parts: examParts,
    handlungsbereiche,
    competency_areas: competencyAreas,
    project_component: project,
    oral_component: oral,
    admission_hints: admissionHints.slice(0, 10),
    pass_rule_hints: passRuleHints.slice(0, 10),
    weighting_hints: weightingHints.slice(0, 10),
    legal_references: legalReferences.slice(0, 10),
  };
}
