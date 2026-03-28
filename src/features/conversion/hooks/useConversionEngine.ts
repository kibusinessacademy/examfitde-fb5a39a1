import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ConversionInput = {
  readiness?: {
    readiness_score: number;
    risk_level: "low" | "medium" | "high";
    weak: number;
  } | null;
};

export type ConversionResult = {
  variant: string;
  headline: string;
  subline?: string;
  cta: string;
  intent: "onboarding" | "weakness_training" | "exam_simulation" | "exam_final";
};

export function useConversionEngine(input: ConversionInput): ConversionResult {
  return useMemo(() => {
    const r = input.readiness;

    if (!r) {
      return {
        variant: "no_data",
        headline: "Starte dein Prüfungstraining",
        cta: "Jetzt starten",
        intent: "onboarding" as const,
      };
    }

    if (r.risk_level === "high") {
      return {
        variant: "high_risk",
        headline: "Du bist noch nicht prüfungsreif",
        subline: "Konzentriere dich jetzt auf deine größten Lücken.",
        cta: "Schwächen gezielt trainieren",
        intent: "weakness_training" as const,
      };
    }

    if (r.risk_level === "medium") {
      return {
        variant: "medium_risk",
        headline: "Du bist fast prüfungsreif",
        subline: "Jetzt kommt es auf gezielte Prüfungssimulation an.",
        cta: "Prüfung simulieren",
        intent: "exam_simulation" as const,
      };
    }

    return {
      variant: "low_risk",
      headline: "Teste dein echtes Prüfungsniveau",
      subline: "Simuliere jetzt die Abschlussprüfung unter echten Bedingungen.",
      cta: "Prüfung starten",
      intent: "exam_final" as const,
    };
  }, [input.readiness]);
}

export async function trackConversion(event: {
  p_user_id: string;
  p_curriculum_id: string;
  p_event_type: string;
  p_intent: string;
  p_readiness_score: number;
  p_risk_level: string;
}) {
  await supabase.rpc("track_conversion_event" as any, event);
}
