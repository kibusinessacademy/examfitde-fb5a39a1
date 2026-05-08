/**
 * Phase D.2 — Slug → package_id Resolver für den Prüfungsreife-Check.
 *
 * Liest aus `v_homepage_course_catalog` (über useHomepageCatalog) das passende
 * published `course_packages.id`. Wenn ein UUID gefunden wird, dürfen die
 * STRICT funnel events `quiz_started` / `quiz_completed` emittiert werden.
 * Sonst bleibt es beim non-strict Fallback `lead_magnet_view`.
 *
 * Kein Shadow-State, kein eigener fetch — wiederverwendet bestehende SSOT-Hook.
 */
import { useMemo } from "react";
import { useHomepageCatalog } from "@/hooks/usePublishedCourses";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PackageResolution {
  packageId: string | null;
  curriculumId: string | null;
  persona: string | null;
  /** True wenn slug gegeben aber Catalog noch lädt → strict-events vorerst nicht emittieren. */
  isLoading: boolean;
  /** True wenn slug gegeben war aber kein published Package gefunden wurde. */
  unmatched: boolean;
}

export function usePackageResolverForSlug(slug: string | null): PackageResolution {
  const { data: catalog, isLoading } = useHomepageCatalog();

  return useMemo<PackageResolution>(() => {
    if (!slug) {
      return { packageId: null, curriculumId: null, persona: null, isLoading: false, unmatched: false };
    }
    if (isLoading || !catalog) {
      return { packageId: null, curriculumId: null, persona: null, isLoading: true, unmatched: false };
    }
    const hit = catalog.find((c) => c.slug === slug);
    if (!hit) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[pruefungsreife] no package for slug="${slug}" — falling back to lead_magnet_view`);
      }
      return { packageId: null, curriculumId: null, persona: null, isLoading: false, unmatched: true };
    }
    const packageId = typeof hit.packageId === "string" && UUID_RE.test(hit.packageId) ? hit.packageId : null;
    return {
      packageId,
      curriculumId: typeof hit.curriculumId === "string" && UUID_RE.test(hit.curriculumId) ? hit.curriculumId : null,
      persona: hit.personaProfile ?? null,
      isLoading: false,
      unmatched: !packageId,
    };
  }, [slug, catalog, isLoading]);
}
