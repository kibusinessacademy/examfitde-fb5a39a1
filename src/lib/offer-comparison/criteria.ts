/**
 * Kriterien-Katalog (SSOT). Reihenfolge = Default-Order in Matrix.
 */
import type { CriterionDef, CriterionKey } from "./types";

export const CRITERIA: CriterionDef[] = [
  { key: "preis", label: "Preis (TCO)", description: "Gesamtkosten über die Vertragslaufzeit.", unit: "€", direction: "lower_better", defaultWeight: 9, group: "preis" },
  { key: "hidden_costs", label: "Versteckte Kosten", description: "Zusatzpositionen, Setup-Fees, Mengenstaffeln, Add-Ons.", unit: "0–10", direction: "lower_better", defaultWeight: 7, group: "preis" },
  { key: "laufzeit", label: "Vertragslaufzeit", description: "Bindungsdauer in Monaten.", unit: "Mon.", direction: "lower_better", defaultWeight: 6, group: "vertrag" },
  { key: "kuendigung", label: "Kündigungsfrist", description: "Tage bis zur möglichen Beendigung.", unit: "Tage", direction: "lower_better", defaultWeight: 6, group: "vertrag" },
  { key: "flexibilitaet", label: "Flexibilität", description: "Anpassbarkeit von Volumen, Modulen, Nutzern.", unit: "0–10", direction: "higher_better", defaultWeight: 7, group: "vertrag" },
  { key: "leistung", label: "Leistungstiefe", description: "Funktionale Breite & Tiefe des Angebots.", unit: "0–10", direction: "higher_better", defaultWeight: 8, group: "leistung" },
  { key: "sla", label: "SLA-Niveau", description: "Garantierte Verfügbarkeit und Reaktionszeiten.", unit: "0–10", direction: "higher_better", defaultWeight: 7, group: "leistung" },
  { key: "support", label: "Support-Level", description: "Verfügbarkeit, Reaktionszeit, Sprache.", unit: "0–10", direction: "higher_better", defaultWeight: 6, group: "betrieb" },
  { key: "integrationen", label: "Integrationen", description: "API, SSO, HRIS, LMS, Webhooks.", unit: "0–10", direction: "higher_better", defaultWeight: 6, group: "betrieb" },
  { key: "skalierbarkeit", label: "Skalierbarkeit", description: "Wachstumspfad bei Nutzern/Volumen.", unit: "0–10", direction: "higher_better", defaultWeight: 7, group: "betrieb" },
  { key: "datenschutz", label: "Datenschutz", description: "DSGVO, AVV, Hosting-Region, Verschlüsselung.", unit: "0–10", direction: "higher_better", defaultWeight: 9, group: "risiko" },
  { key: "transparenz", label: "Transparenz", description: "Klarheit der Preis- und Leistungsbeschreibung.", unit: "0–10", direction: "higher_better", defaultWeight: 7, group: "risiko" },
  { key: "risiko", label: "Risiko-Index", description: "Aggregierter Risiko-Score aus Risk Engine.", unit: "0–10", direction: "lower_better", defaultWeight: 9, group: "risiko" },
];

export const CRITERIA_BY_KEY: Record<CriterionKey, CriterionDef> = Object.fromEntries(
  CRITERIA.map((c) => [c.key, c]),
) as Record<CriterionKey, CriterionDef>;

export const DEFAULT_ACTIVE_CRITERIA: CriterionKey[] = CRITERIA.map((c) => c.key);
