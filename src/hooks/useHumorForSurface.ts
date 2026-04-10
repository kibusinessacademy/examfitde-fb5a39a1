import { useEffect, useState, useCallback, useRef } from "react";
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

export type HumorStatus = "loading" | "ready" | "empty" | "disabled" | "error";

type HumorState = {
  item: HumorItem | null;
  status: HumorStatus;
  /** ID of the delivery event for precise reaction tracking */
  deliveryEventId: string | null;
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
  const [state, setState] = useState<HumorState>({ item: null, status: "loading", deliveryEventId: null });

  // Dedupe key to prevent multiple fetches for the same context
  const fetchKeyRef = useRef<string>("");

  const fetchHumor = useCallback(async () => {
    const key = `${certificationId}|${surface}|${competenceId ?? ""}|${lessonId ?? ""}`;

    if (!certificationId || !enabled) {
      setState({ item: null, status: "disabled", deliveryEventId: null });
      return;
    }

    // Skip if we already fetched for this exact context
    if (fetchKeyRef.current === key && state.status === "ready") return;

    setState(s => ({ ...s, status: "loading" }));
    try {
      const { data, error } = await supabase.rpc("get_humor_for_surface" as any, {
        p_certification_id: certificationId,
        p_surface: surface,
        ...(competenceId ? { p_competence_id: competenceId } : {}),
        ...(lessonId ? { p_lesson_id: lessonId } : {}),
      });

      if (error) {
        console.error("[useHumorForSurface]", error);
        setState({ item: null, status: "error", deliveryEventId: null });
        return;
      }

      const rows = data as unknown as HumorItem[];
      if (!rows || rows.length === 0) {
        setState({ item: null, status: "empty", deliveryEventId: null });
        fetchKeyRef.current = key;
        return;
      }

      const item = rows[0];
      fetchKeyRef.current = key;

      // Track delivery event and capture event ID
      let deliveryEventId: string | null = null;
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          const { data: eventData } = await supabase
            .from("humor_delivery_events" as any)
            .insert({
              humor_item_id: item.id,
              user_id: userData.user.id,
              surface,
              context_ref: contextRef ?? lessonId ?? competenceId ?? null,
            })
            .select("id")
            .single();

          deliveryEventId = (eventData as any)?.id ?? null;
        }
      } catch {
        // Delivery tracking is non-critical
      }

      setState({ item, status: "ready", deliveryEventId });
    } catch (err) {
      console.error("[useHumorForSurface] fetch error", err);
      setState({ item: null, status: "error", deliveryEventId: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certificationId, surface, competenceId, lessonId, contextRef, enabled]);

  useEffect(() => {
    fetchHumor();
  }, [fetchHumor]);

  const trackReaction = useCallback(async (reaction: "liked" | "disliked" | "skipped" | "shared") => {
    if (!state.deliveryEventId) return;
    try {
      await supabase
        .from("humor_delivery_events" as any)
        .update({ reaction })
        .eq("id", state.deliveryEventId);
    } catch (err) {
      console.error("[useHumorForSurface] reaction error", err);
    }
  }, [state.deliveryEventId]);

  // Backwards-compatible convenience booleans
  const loading = state.status === "loading";
  const disabled = state.status === "disabled" || state.status === "empty";

  return {
    item: state.item,
    status: state.status,
    loading,
    disabled,
    trackReaction,
    refresh: fetchHumor,
  };
}
