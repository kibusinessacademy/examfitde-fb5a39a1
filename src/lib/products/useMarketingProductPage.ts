/**
 * useMarketingProductPage — DB-first read with TS-registry fallback.
 * Welle 2 of marketing product pages.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PRODUCTS, type ProductDef, type ProductSlug } from "./product-registry";

export interface MarketingProductPageRow {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  hero_kicker: string | null;
  hero_headline: string;
  hero_subline: string | null;
  product_intro: string | null;
  usps: { title: string; body: string }[];
  faqs: { question: string; answer: string }[];
  trust_items: unknown[];
  changelog: { version: string; body: string; released_at?: string }[];
  cta_primary_label: string | null;
  cta_primary_url: string | null;
  cta_secondary_label: string | null;
  cta_secondary_url: string | null;
  persona_cta_map: Record<string, { label: string; href: string }>;
  seo_title: string | null;
  seo_description: string | null;
  seo_canonical: string | null;
  seo_og_image: string | null;
  updated_at: string;
  published_at: string | null;
}

/** Map a DB row + static fallback into the ProductDef shape used by the shell. */
export function rowToProductDef(
  row: MarketingProductPageRow,
  fallback: ProductDef | undefined,
): ProductDef {
  const base: ProductDef = fallback ?? {
    slug: row.slug as ProductSlug,
    name: row.slug,
    category: "",
    status: "live",
    hero: { eyebrow: "", headline: "", subline: "" },
    usps: [],
    cta: { default: { label: "Mehr erfahren", href: "/" } },
    faqs: [],
    meta: { title: row.slug, description: "" },
  };

  return {
    ...base,
    hero: {
      eyebrow: row.hero_kicker ?? base.hero.eyebrow,
      headline: row.hero_headline ?? base.hero.headline,
      subline: row.hero_subline ?? base.hero.subline,
    },
    usps: row.usps?.length ? row.usps : base.usps,
    faqs: row.faqs?.length ? row.faqs : base.faqs,
    cta: {
      ...base.cta,
      default: {
        label: row.cta_primary_label ?? base.cta.default.label,
        href: row.cta_primary_url ?? base.cta.default.href,
      },
      ...(row.persona_cta_map ?? {}),
    },
    meta: {
      title: row.seo_title ?? base.meta.title,
      description: row.seo_description ?? base.meta.description,
    },
  };
}

export function useMarketingProductPage(slug: string | undefined) {
  return useQuery({
    queryKey: ["marketing_product_page", slug],
    enabled: Boolean(slug),
    staleTime: 60_000,
    queryFn: async (): Promise<ProductDef | null> => {
      if (!slug) return null;
      const fallback = PRODUCTS[slug as ProductSlug];
      const { data, error } = await supabase
        .from("marketing_product_pages" as any)
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();

      if (error || !data) return fallback ?? null;
      return rowToProductDef(data as unknown as MarketingProductPageRow, fallback);
    },
  });
}
