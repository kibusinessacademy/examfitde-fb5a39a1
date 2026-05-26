/**
 * HR Deadline OS — SSOT für Kündigungsfristen nach §622 BGB.
 *
 * Pure data. KEINE DB. KEINE AI. Versioniert über `ruleVersion`.
 * Erweiterungen (Tarif, Sonderkündigungsschutz, Ausbildung) als eigene Slices.
 */

export type EmploymentRole = "arbeitgeber" | "arbeitnehmer";
export type ContractType = "unbefristet" | "probezeit" | "ausbildung_probezeit" | "ausbildung_nach_probezeit";

export interface DeadlineRule {
  id: string;
  applies: {
    role?: EmploymentRole;
    contract: ContractType;
    minTenureMonths: number; // inkl.
    maxTenureMonths?: number; // exkl.
  };
  duration: number;
  unit: "tage" | "wochen" | "monate";
  targetRule: "monatsende" | "fuenfzehnter_oder_monatsende" | "beliebig";
  legalReference: string;
  notes: string;
}

export const DEADLINE_RULESET_VERSION = "2026.05.26-bgb622";

export const DEADLINE_RULES: DeadlineRule[] = [
  // Probezeit (Arbeitsverhältnis)
  {
    id: "probezeit_2w",
    applies: { contract: "probezeit", minTenureMonths: 0, maxTenureMonths: 6 },
    duration: 2,
    unit: "wochen",
    targetRule: "beliebig",
    legalReference: "§622 Abs. 3 BGB",
    notes: "In der Probezeit (max. 6 Monate) gilt eine Kündigungsfrist von 2 Wochen ohne Termin.",
  },
  // Grundfrist (unbefristet, <2 J)
  {
    id: "grundfrist_4w",
    applies: { contract: "unbefristet", minTenureMonths: 0, maxTenureMonths: 24 },
    duration: 4,
    unit: "wochen",
    targetRule: "fuenfzehnter_oder_monatsende",
    legalReference: "§622 Abs. 1 BGB",
    notes: "Grundfrist: 4 Wochen zum 15. oder Monatsende.",
  },
  // Verlängerte Fristen (gelten nur für Arbeitgeber laut §622 Abs. 2 BGB)
  { id: "ag_2j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 24, maxTenureMonths: 60 }, duration: 1, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 1 BGB", notes: "Ab 2 Jahren Betriebszugehörigkeit: 1 Monat zum Monatsende." },
  { id: "ag_5j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 60, maxTenureMonths: 96 }, duration: 2, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 2 BGB", notes: "Ab 5 Jahren: 2 Monate zum Monatsende." },
  { id: "ag_8j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 96, maxTenureMonths: 120 }, duration: 3, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 3 BGB", notes: "Ab 8 Jahren: 3 Monate zum Monatsende." },
  { id: "ag_10j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 120, maxTenureMonths: 144 }, duration: 4, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 4 BGB", notes: "Ab 10 Jahren: 4 Monate zum Monatsende." },
  { id: "ag_12j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 144, maxTenureMonths: 180 }, duration: 5, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 5 BGB", notes: "Ab 12 Jahren: 5 Monate zum Monatsende." },
  { id: "ag_15j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 180, maxTenureMonths: 240 }, duration: 6, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 6 BGB", notes: "Ab 15 Jahren: 6 Monate zum Monatsende." },
  { id: "ag_20j", applies: { role: "arbeitgeber", contract: "unbefristet", minTenureMonths: 240 }, duration: 7, unit: "monate", targetRule: "monatsende", legalReference: "§622 Abs. 2 Nr. 7 BGB", notes: "Ab 20 Jahren: 7 Monate zum Monatsende." },
  // Ausbildung
  { id: "azubi_probe", applies: { contract: "ausbildung_probezeit", minTenureMonths: 0, maxTenureMonths: 4 }, duration: 0, unit: "tage", targetRule: "beliebig", legalReference: "§22 Abs. 1 BBiG", notes: "Während der Probezeit (1–4 Monate) kann das Ausbildungsverhältnis jederzeit ohne Frist gekündigt werden." },
  { id: "azubi_normal_ausbilder", applies: { role: "arbeitgeber", contract: "ausbildung_nach_probezeit", minTenureMonths: 4 }, duration: 0, unit: "tage", targetRule: "beliebig", legalReference: "§22 Abs. 2 BBiG", notes: "Nach Probezeit nur aus wichtigem Grund fristlos kündbar (Ausbilder)." },
  { id: "azubi_normal_azubi", applies: { role: "arbeitnehmer", contract: "ausbildung_nach_probezeit", minTenureMonths: 4 }, duration: 4, unit: "wochen", targetRule: "beliebig", legalReference: "§22 Abs. 2 Nr. 2 BBiG", notes: "Azubi kann mit 4 Wochen Frist kündigen — z. B. bei Berufsaufgabe oder Berufswechsel." },
];

export interface WarningFlag {
  code: string;
  label: string;
  body: string;
}

export const DEFAULT_WARNINGS: WarningFlag[] = [
  { code: "tarifvertrag", label: "Tarifvertrag kann abweichen", body: "Tarifverträge können die gesetzlichen Fristen verlängern oder verkürzen — Vertrag und ggf. anwendbaren TV prüfen." },
  { code: "betriebsrat", label: "Betriebsrat ggf. anhören", body: "Vor einer Kündigung ist der Betriebsrat nach §102 BetrVG zwingend anzuhören — sonst ist die Kündigung unwirksam." },
  { code: "sonderkuendigungsschutz", label: "Sonderkündigungsschutz prüfen", body: "Schwangerschaft (§17 MuSchG), Elternzeit (§18 BEEG), Schwerbehinderung (§168 SGB IX), Datenschutzbeauftragte u. a. genießen Sonderschutz." },
  { code: "zugang", label: "Zugang ist entscheidend", body: "Maßgeblich ist nicht das Absende-, sondern das Zugangsdatum der Kündigungserklärung beim Empfänger." },
];
