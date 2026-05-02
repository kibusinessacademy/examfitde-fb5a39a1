import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProductPersona } from '@/lib/landing/productPersonaContext';

export interface ProductPersonaOverlay {
  packageId: string;
  personaType: ProductPersona;
  heroKicker: string | null;
  heroHeadline: string;
  heroSubline: string;
  primaryCta: string;
  secondaryCta: string | null;
  uspItems: string[];
  painPoints: string[];
  trustItems: string[];
  seoTitle: string | null;
  seoDescription: string | null;
}

interface OverlayRow {
  package_id: string;
  persona_type: string;
  hero_kicker: string | null;
  hero_headline: string;
  hero_subline: string;
  primary_cta: string;
  secondary_cta: string | null;
  usp_items: string[] | null;
  pain_points: string[] | null;
  trust_items: string[] | null;
  seo_title: string | null;
  seo_description: string | null;
}

/**
 * Persona-Overlay Reader (SSOT-konform).
 *
 * Liest persona-spezifische Copy/CTA/SEO-Wording aus `product_persona_overlays`.
 * Truth-Daten (Preis, Curriculum, Capabilities) bleiben in v_product_page_published_ssot.
 * Overlay ist optional — fehlt es, fallen Komponenten auf SSOT-Defaults zurück.
 */
export function useProductPersonaOverlay(
  packageId: string | null | undefined,
  persona: ProductPersona | null | undefined,
) {
  return useQuery<ProductPersonaOverlay | null>({
    queryKey: ['product-persona-overlay', packageId, persona],
    enabled: Boolean(packageId && persona),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      console.log('[useProductPersonaOverlay] fetch', { packageId, persona });
      if (!packageId || !persona) return null;

      const { data, error } = await (supabase as any)
        .from('product_persona_overlays')
        .select('*')
        .eq('package_id', packageId)
        .eq('persona_type', persona)
        .eq('active', true)
        .maybeSingle();

      if (error) {
        // Soft-Fail: Overlay ist optional — Fallback auf SSOT-Defaults im Caller.
        console.warn('[useProductPersonaOverlay] read failed:', error.message);
        return null;
      }
      if (!data) return null;

      const row = data as OverlayRow;
      return {
        packageId: row.package_id,
        personaType: row.persona_type as ProductPersona,
        heroKicker: row.hero_kicker,
        heroHeadline: row.hero_headline,
        heroSubline: row.hero_subline,
        primaryCta: row.primary_cta,
        secondaryCta: row.secondary_cta,
        uspItems: row.usp_items ?? [],
        painPoints: row.pain_points ?? [],
        trustItems: row.trust_items ?? [],
        seoTitle: row.seo_title,
        seoDescription: row.seo_description,
      };
    },
  });
}
