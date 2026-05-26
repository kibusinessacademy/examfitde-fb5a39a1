/**
 * Negotiation AI (deterministic template-based, ready for later AI augmentation).
 * Tone-Selector: neutral | professionell | hart | partnerschaftlich.
 */
import type { Offer, Project, RiskFinding } from "./types";

export type NegotiationTone = "neutral" | "professionell" | "hart" | "partnerschaftlich";

export interface NegotiationLever {
  id: string;
  title: string;
  argument: string;
  ask: string;
  impactEur?: number;
}

const TONE_INTRO: Record<NegotiationTone, string> = {
  neutral: "Bitte klären Sie folgenden Punkt:",
  professionell: "Wir würden uns über eine Anpassung folgender Position freuen:",
  hart: "Wir können den Vertrag in der vorliegenden Form nicht unterzeichnen, solange:",
  partnerschaftlich: "Damit wir partnerschaftlich starten können, schlagen wir vor:",
};

export function topLevers(project: Project, offer: Offer, risks: RiskFinding[]): NegotiationLever[] {
  const offerRisks = risks
    .filter((r) => r.offerId === offer.id)
    .sort((a, b) => rank(b.level) - rank(a.level));

  const levers: NegotiationLever[] = offerRisks.slice(0, 5).map((r, i) => ({
    id: `${offer.id}-l${i}`,
    title: r.title,
    argument: r.meaning,
    ask: r.negotiation,
  }));

  // TCO-Hebel ergänzen wenn Budget überschritten
  if (offer.totalCostEur > project.budgetEur) {
    levers.unshift({
      id: `${offer.id}-budget`,
      title: "Budget-Anpassung",
      argument: `Angebot überschreitet das genehmigte Budget von ${fmt(project.budgetEur)} um ${fmt(
        offer.totalCostEur - project.budgetEur,
      )}.`,
      ask: `Preisreduktion um mindestens ${fmt(offer.totalCostEur - project.budgetEur)} oder Leistungsumfang reduzieren.`,
      impactEur: offer.totalCostEur - project.budgetEur,
    });
  }
  return levers.slice(0, 5);
}

export function draftEmail(project: Project, offer: Offer, levers: NegotiationLever[], tone: NegotiationTone): string {
  const lines = [
    `Betreff: ${project.name} — Anpassungswünsche zum Angebot ${offer.productName}`,
    "",
    "Sehr geehrte Damen und Herren,",
    "",
    `vielen Dank für Ihr Angebot vom [Datum] zum Projekt "${project.name}".`,
    "Nach interner Bewertung möchten wir vor Vertragsunterzeichnung folgende Punkte adressieren:",
    "",
    ...levers.map((l, i) => `${i + 1}. ${l.title}\n   ${TONE_INTRO[tone]} ${l.ask}`),
    "",
    "Wir erwarten Ihre Rückmeldung innerhalb von 7 Werktagen und stehen für ein kurzes Abstimmungsgespräch zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
    "[Name, Funktion]",
  ];
  return lines.join("\n");
}

function rank(level: RiskFinding["level"]): number {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[level];
}

function fmt(n: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
