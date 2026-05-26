/**
 * One-Click Demo Scenarios — sofort sichtbare Intelligence.
 * Jedes Szenario referenziert eine Sample-Cohort + eine Story-Sicht.
 */
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, TrendingUp, GitCompareArrows, Activity, Sparkles, Users } from "lucide-react";

export interface DemoScenario {
  id: string;
  title: string;
  description: string;
  cohortSlug: string;
  view: "risk" | "recovery" | "exam_risk" | "compare" | "intervention" | "narrative";
  icon: LucideIcon;
  estimatedSeconds: number;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "scen_risk_cohort",
    title: "Gefährdete Kohorte simulieren",
    description: "Zeige die FISI-Kohorte mit roten Risiko-Lernenden, Drivern und Recovery-Vorschlägen.",
    cohortSlug: "fisi-fruehjahr-2026",
    view: "risk",
    icon: AlertTriangle,
    estimatedSeconds: 45,
  },
  {
    id: "scen_recovery_effect",
    title: "Recovery-Wirkung anzeigen",
    description: "Wie wirken Recovery-Sets auf Steuerrecht & Konzernrechnungslegung?",
    cohortSlug: "bilanzbuchhalter-intensiv",
    view: "recovery",
    icon: TrendingUp,
    estimatedSeconds: 50,
  },
  {
    id: "scen_exam_risk",
    title: "Prüfungsrisiko analysieren",
    description: "Outcome-Forecast für AP2 Industriekaufleute mit Drivern.",
    cohortSlug: "industriekaufleute-ap2",
    view: "exam_risk",
    icon: Activity,
    estimatedSeconds: 40,
  },
  {
    id: "scen_compare",
    title: "Kohorten vergleichen",
    description: "Side-by-Side: FISI vs. Industriekaufleute — Risiko, Recovery, Outcome.",
    cohortSlug: "fisi-fruehjahr-2026",
    view: "compare",
    icon: GitCompareArrows,
    estimatedSeconds: 55,
  },
  {
    id: "scen_intervention",
    title: "Intervention durchspielen",
    description: "AEVO: Konzeptions-Workflow → +19% Lift bei 7 Teilnehmern.",
    cohortSlug: "aevo-gruppe-q2",
    view: "intervention",
    icon: Users,
    estimatedSeconds: 35,
  },
  {
    id: "scen_narrative",
    title: "AI-Narrative generieren",
    description: "Executive-Summary in 3 Sätzen — deterministisch aus Graph-Evidence.",
    cohortSlug: "bilanzbuchhalter-intensiv",
    view: "narrative",
    icon: Sparkles,
    estimatedSeconds: 30,
  },
];
