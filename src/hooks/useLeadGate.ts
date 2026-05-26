/**
 * useLeadGate — entscheidet, ob vor dem Checkout ein Soft-Nudge zur Diagnose
 * gezeigt werden muss. Hard-Block ist NICHT Ziel.
 *
 * Curriculum-spezifischer Resolve (kein globaler Quiz-Fallback):
 *   1. curriculumId direkt
 *   2. packageId  → course_packages.curriculum_id
 *   3. productSlug → products.id → course_packages.curriculum_id
 *
 * Wenn keine curriculum_id resolvbar ist:
 *   - Modal trotzdem zeigen (Soft-Nudge)
 *   - reason='curriculum_resolve_failed' wird beim shown-Event mitgegeben
 *
 * SSOT: Wir prüfen nur quiz_attempts.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId } from "@/lib/conversionTracking";
import { useAuth } from "@/hooks/useAuth";

const RECENT_DAYS = 30;

export type LeadGateResolveReason =
  | "curriculum_direct"
  | "resolved_from_package"
  | "resolved_from_product_slug"
  | "curriculum_resolve_failed";

export interface LeadGateState {
  loading: boolean;
  /** true = darf direkt kaufen (recent attempt für DIESES curriculum). Modal NICHT zeigen. */
  hasRecentAttempt: boolean;
  /** Aufgelöste curriculum_id (oder null). */
  resolvedCurriculumId: string | null;
  /** Wie wurde aufgelöst — gehört in shown-Event-Metadata. */
  resolveReason: LeadGateResolveReason;
}

export interface LeadGateOptions {
  curriculumId?: string | null;
  packageId?: string | null;
  productSlug?: string | null;
  enabled?: boolean;
}

async function resolveCurriculumId(
  curriculumId: string | null,
  packageId: string | null,
  productSlug: string | null,
): Promise<{ id: string | null; reason: LeadGateResolveReason }> {
  if (curriculumId) return { id: curriculumId, reason: "curriculum_direct" };

  if (packageId) {
    const { data } = await (supabase as any)
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .maybeSingle();
    if (data?.curriculum_id) {
      return { id: data.curriculum_id as string, reason: "resolved_from_package" };
    }
  }

  if (productSlug) {
    const { data: product } = await (supabase as any)
      .from("products")
      .select("id")
      .eq("slug", productSlug)
      .maybeSingle();
    const productId = product?.id as string | undefined;
    if (productId) {
      const { data: pkg } = await (supabase as any)
        .from("course_packages")
        .select("curriculum_id")
        .eq("product_id", productId)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pkg?.curriculum_id) {
        return { id: pkg.curriculum_id as string, reason: "resolved_from_product_slug" };
      }
    }
  }

  return { id: null, reason: "curriculum_resolve_failed" };
}

export function useLeadGate(options: LeadGateOptions = {}): LeadGateState {
  const {
    curriculumId = null,
    packageId = null,
    productSlug = null,
    enabled = true,
  } = options;
  const { user } = useAuth();
  const [state, setState] = useState<LeadGateState>({
    loading: enabled,
    hasRecentAttempt: false,
    resolvedCurriculumId: curriculumId ?? null,
    resolveReason: curriculumId ? "curriculum_direct" : "curriculum_resolve_failed",
  });

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setState({
        loading: false,
        hasRecentAttempt: false,
        resolvedCurriculumId: null,
        resolveReason: "curriculum_resolve_failed",
      });
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      const resolved = await resolveCurriculumId(curriculumId, packageId, productSlug);
      if (cancelled) return;

      // Ohne curriculum_id KEIN globaler Fallback — Modal zeigen.
      if (!resolved.id) {
        setState({
          loading: false,
          hasRecentAttempt: false,
          resolvedCurriculumId: null,
          resolveReason: resolved.reason,
        });
        return;
      }

      const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const anonId = user ? null : getAnonymousId();

      if (!user && !anonId) {
        if (!cancelled) {
          setState({
            loading: false,
            hasRecentAttempt: false,
            resolvedCurriculumId: resolved.id,
            resolveReason: resolved.reason,
          });
        }
        return;
      }

      const { data: count, error } = await (supabase as any).rpc(
        "public_count_recent_quiz_attempts",
        {
          _curriculum_id: resolved.id,
          _anonymous_id: anonId,
          _since: since,
        }
      );
      if (cancelled) return;
      setState({
        loading: false,
        hasRecentAttempt: !error && Number(count ?? 0) > 0,
        resolvedCurriculumId: resolved.id,
        resolveReason: resolved.reason,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [curriculumId, packageId, productSlug, enabled, user?.id]);

  return state;
}
