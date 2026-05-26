/**
 * Risk Detection Engine (deterministic, rule-based).
 *
 * Erkennt Lock-in, Hidden Costs, schwache Kündigung, fehlende SLA,
 * Datenschutz-Lücken, Auto-Renewal, Vendor Dependency.
 */
import type { Offer, Project, RiskFinding, RiskLevel } from "./types";

let idSeed = 1;
function nid(prefix: string) {
  return `${prefix}-${idSeed++}`;
}

function rule(
  offer: Offer,
  cond: boolean,
  level: RiskLevel,
  title: string,
  detail: string,
  meaning: string,
  negotiation: string,
  evidence?: string,
): RiskFinding | null {
  if (!cond) return null;
  return {
    id: nid(offer.id.slice(0, 4)),
    offerId: offer.id,
    level,
    title,
    detail,
    meaning,
    negotiation,
    evidence,
  };
}

function v(offer: Offer, key: string): number | undefined {
  return offer.values.find((x) => x.key === key)?.value;
}

export function detectRisks(project: Project): RiskFinding[] {
  idSeed = 1;
  const findings: RiskFinding[] = [];

  for (const offer of project.offers) {
    const hidden = v(offer, "hidden_costs") ?? 0;
    const sla = v(offer, "sla") ?? 0;
    const ds = v(offer, "datenschutz") ?? 0;
    const transp = v(offer, "transparenz") ?? 0;
    const flex = v(offer, "flexibilitaet") ?? 0;

    [
      rule(
        offer,
        offer.termMonths >= 36,
        offer.termMonths >= 48 ? "high" : "medium",
        "Lange Vertragsbindung",
        `Laufzeit ${offer.termMonths} Monate — überdurchschnittlich für die Kategorie.`,
        "Lange Bindung erhöht Lock-in und reduziert Verhandlungshebel bei zukünftigen Marktveränderungen.",
        "Laufzeit auf 12–24 Monate verkürzen oder Sonderkündigungsrecht bei wesentlicher Leistungsänderung.",
        "Vertragsteil §2",
      ),
      rule(
        offer,
        offer.noticePeriodDays >= 90,
        offer.noticePeriodDays >= 180 ? "high" : "medium",
        "Schwache Kündigungskonditionen",
        `${offer.noticePeriodDays} Tage Kündigungsfrist.`,
        "Späte Kündigung bedeutet hohe Opportunitätskosten bei Wechsel.",
        "Kündigungsfrist auf 30–60 Tage reduzieren.",
        "Vertragsteil §3",
      ),
      rule(
        offer,
        offer.autoRenewal === true,
        "medium",
        "Automatische Verlängerung",
        "Vertrag verlängert sich automatisch, wenn nicht rechtzeitig gekündigt wird.",
        "Auto-Renewal kann zu ungewollter Vertragsverlängerung führen — typische Falle.",
        "Auto-Renewal entfernen oder mindestens schriftliche Erinnerungspflicht 60 Tage vor Ablauf vereinbaren.",
      ),
      rule(
        offer,
        hidden >= 7,
        hidden >= 9 ? "high" : "medium",
        "Hohe versteckte Kostenanteile",
        `Hidden-Cost-Index ${hidden}/10.`,
        "Setup-Fees, Add-Ons und Mengenstaffeln können den TCO signifikant erhöhen.",
        "Festpreis pro definierter Leistungseinheit verhandeln, Add-Ons im Hauptvertrag verankern.",
      ),
      rule(
        offer,
        sla <= 4,
        sla <= 2 ? "critical" : "high",
        "Schwaches oder fehlendes SLA",
        `SLA-Score ${sla}/10.`,
        "Ohne klare SLAs gibt es keine Schadensregulierung bei Ausfällen oder Reaktionszeitenversäumnissen.",
        "Mindest-SLA mit Verfügbarkeit ≥99.5%, Reaktionszeit ≤4h für P1, Pönale bei Nichteinhaltung.",
      ),
      rule(
        offer,
        ds <= 5,
        ds <= 3 ? "critical" : "high",
        "Datenschutz-Lücken",
        `Datenschutz-Score ${ds}/10.`,
        "DSGVO-Konformität ist Pflicht — Lücken bedeuten Bußgeld- und Reputationsrisiko.",
        "AVV nach Art. 28 DSGVO, Hosting in EU/EEA, Verschlüsselung at-rest + in-transit dokumentieren.",
      ),
      rule(
        offer,
        transp <= 5,
        transp <= 3 ? "high" : "medium",
        "Geringe Preis-/Leistungstransparenz",
        `Transparenz-Score ${transp}/10.`,
        "Unklare Leistungsbeschreibung führt später zu Streit über Lieferumfang und Mehrkosten.",
        "Detaillierten Leistungskatalog als Vertragsanlage einfordern, Mengen und Akzeptanzkriterien definieren.",
      ),
      rule(
        offer,
        flex <= 4,
        "medium",
        "Geringe Flexibilität",
        `Flexibilität-Score ${flex}/10.`,
        "Wenig Spielraum bei Volumen-/Modul-Änderungen erhöht Risiko bei sich änderndem Bedarf.",
        "Skalierungs-Klausel mit Auf-/Abwärtsschritten alle 6 Monate vereinbaren.",
      ),
    ].forEach((r) => r && findings.push(r));
  }

  return findings;
}

export const LEVEL_RANK: Record<RiskLevel, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export const LEVEL_META: Record<
  RiskLevel,
  { label: string; tone: "success" | "info" | "warning" | "error" | "muted" }
> = {
  info: { label: "Info", tone: "muted" },
  low: { label: "Low", tone: "info" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "error" },
  critical: { label: "Critical", tone: "error" },
};
