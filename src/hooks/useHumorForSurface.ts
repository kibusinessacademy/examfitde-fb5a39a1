import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type HumorSurface =
  | "dashboard"
  | "lesson_intro"
  | "lesson_outro"
  | "minicheck_intro"
  | "minicheck_result"
  | "tutor"
  | "exam_break";

type HumorItem = {
  id: string;
  text: string;
  humor_type: string;
  tone: string;
  modernity_level: number;
  competence_id: string | null;
  lesson_id: string | null;
  quality_score: number;
};

type HumorState = {
  item: HumorItem | null;
  loading: boolean;
  disabled: boolean;
};

export function useHumorForSurface(opts: {
  certificationId: string | null | undefined;
  surface: HumorSurface;
  competenceId?: string | null;
  lessonId?: string | null;
  contextRef?: string | null;
  enabled?: boolean;
}) {
  const { certificationId, surface, competenceId, lessonId, contextRef, enabled = true } = opts;
  const [state, setState] = useState<HumorState>({ item: null, loading: true, disabled: false });

  const fetchHumor = useCallback(async () => {
    if (!certificationId || !enabled) {
      setState({ item: null, loading: false, disabled: false });
      return;
    }

    setState(s => ({ ...s, loading: true }));
    try {
      const { data, error } = await supabase.rpc("get_humor_for_surface" as any, {
        p_certification_id: certificationId,
        p_surface: surface,
        ...(competenceId ? { p_competence_id: competenceId } : {}),
        ...(lessonId ? { p_lesson_id: lessonId } : {}),
      });

      if (error) {
        console.error("[useHumorForSurface]", error);
        setState({ item: null, loading: false, disabled: false });
        return;
      }

      const rows = data as unknown as HumorItem[];
      if (!rows || rows.length === 0) {
        setState({ item: null, loading: false, disabled: true });
        return;
      }

      const item = rows[0];
      setState({ item, loading: false, disabled: false });

      // Track delivery event (fire-and-forget)
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        supabase.from("humor_delivery_events" as any).insert({
          humor_item_id: item.id,
          user_id: userData.user.id,
          surface,
          context_ref: contextRef ?? lessonId ?? competenceId ?? null,
        }).then(() => {});
      }
    } catch (err) {
      console.error("[useHumorForSurface] fetch error", err);
      setState({ item: null, loading: false, disabled: false });
    }
  }, [certificationId, surface, competenceId, lessonId, contextRef, enabled]);

  useEffect(() => {
    fetchHumor();
  }, [fetchHumor]);

  const trackReaction = useCallback(async (reaction: "liked" | "disliked" | "skipped" | "shared") => {
    if (!state.item) return;
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;

      // Update the most recent delivery event for this item
      await supabase
        .from("humor_delivery_events" as any)
        .update({ reaction })
        .eq("humor_item_id", state.item.id)
        .eq("user_id", userData.user.id)
        .eq("surface", surface)
        .order("created_at", { ascending: false })
        .limit(1);
    } catch (err) {
      console.error("[useHumorForSurface] reaction error", err);
    }
  }, [state.item, surface]);

  return { ...state, trackReaction, refresh: fetchHumor };
}
