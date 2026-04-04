import { supabase } from "@/integrations/supabase/client";

export async function loadLandingData(slug: string, landingType: string) {
  const { data: cert, error: certError } = await supabase
    .from("certifications")
    .select("id, slug, title, track, certification_type, validation_profile")
    .eq("slug", slug)
    .single();

  if (certError || !cert) throw new Error(certError?.message ?? "Certification not found");

  const [{ data: modules }, { data: pricing }, { data: profile }] = await Promise.all([
    supabase
      .from("product_module_configs")
      .select("exam_trainer, exam_simulation, mini_checks, ai_tutor, oral_exam, handbook")
      .eq("certification_id", cert.id)
      .single(),
    supabase
      .from("product_pricing_configs")
      .select("one_time_price, access_months, compare_at_price, b2b_price_10, b2b_price_50, b2b_price_200")
      .eq("certification_id", cert.id)
      .single(),
    supabase
      .from("product_landing_profiles")
      .select("landing_type, primary_goal, target_pain_points, primary_cta, secondary_cta, hero_headline, hero_subline, usp_items, proof_items, faq_seed, seo_title, seo_description")
      .eq("certification_id", cert.id)
      .eq("landing_type", landingType)
      .maybeSingle(),
  ]);

  return {
    certification: cert,
    modules: modules ?? null,
    pricing: pricing ?? null,
    profile: profile ?? null,
  };
}
