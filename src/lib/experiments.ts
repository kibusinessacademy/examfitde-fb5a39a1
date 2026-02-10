import { supabase } from "@/integrations/supabase/client";

/**
 * Get the A/B variant for the current user in a given experiment.
 * Returns "A" or "B" (or null if not assigned / error).
 */
export async function getVariant(experimentId: string): Promise<"A" | "B" | null> {
  try {
    const { data, error } = await supabase.functions.invoke("experiment-api", {
      body: { action: "assign", experimentId },
    });
    if (error) {
      console.error("[experiments] assign error", error);
      return null;
    }
    return (data as any)?.variant ?? null;
  } catch (e) {
    console.error("[experiments] assign exception", e);
    return null;
  }
}

/**
 * Track an event for the current user in an experiment.
 */
export async function trackEvent(
  experimentId: string,
  eventType: string,
  value?: number,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("experiment-api", {
      body: { action: "track", experimentId, eventType, value, metadata },
    });
    if (error) {
      console.error("[experiments] track error", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[experiments] track exception", e);
    return false;
  }
}