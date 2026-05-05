import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useExperimentVariant } from "@/hooks/useExperimentVariant";

type VariantMap = Record<string, { label: string; desc?: string }>;

interface ExperimentRow {
  id: string;
  variants: VariantMap;
  status: string;
}

const EXPERIMENT_NAME = "buy_cta_persona_v1";

/**
 * Buy-CTA A/B (Persona-Overlay) — looks up the running `buy_cta_persona_v1`
 * experiment, assigns a sticky variant, returns the variant CTA label.
 *
 * Returns `{ variant, label }` where label may be null while loading or
 * if the experiment is paused/ended (caller falls back to overlay/SSOT label).
 */
export function useBuyCtaExperiment() {
  const [exp, setExp] = useState<ExperimentRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("experiments")
        .select("id, variants, status")
        .eq("name", EXPERIMENT_NAME)
        .eq("status", "running")
        .maybeSingle();
      if (!cancelled && data) setExp(data as ExperimentRow);
    })();
    return () => { cancelled = true; };
  }, []);

  const { variant } = useExperimentVariant(exp?.id ?? null);

  const label = useMemo(() => {
    if (!exp || !variant) return null;
    return exp.variants?.[variant]?.label ?? null;
  }, [exp, variant]);

  return { variant, label, experimentId: exp?.id ?? null };
}
