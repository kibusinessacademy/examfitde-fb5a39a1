export interface ProductPageSSOTRow {
  package_id: string;
  course_id: string | null;
  curriculum_id: string;
  beruf_id: string | null;

  canonical_slug: string;
  canonical_url: string;
  canonical_title: string;
  canonical_title_norm: string | null;
  product_type: string;
  status: string;
  published_at: string | null;
  updated_at: string | null;

  beruf_display_name: string | null;
  beruf_kurz: string | null;
  beruf_lang: string | null;
  kammer: string | null;
  track: string | null;
  curriculum_track: string | null;
  persona_profile: string | null;
  exam_focus: string | null;
  exam_mode_available: boolean | null;
  oral_mode_available: boolean | null;
  ai_tutor_available: boolean | null;
  handbook_available: boolean | null;
  minichecks_available: boolean | null;

  hero_headline: string | null;
  hero_subline: string | null;
  hero_kicker: string | null;
  product_intro: string | null;
  pain_headline: string | null;
  pain_copy: string | null;
  usp_headline: string | null;
  usp_copy: string | null;
  how_it_works_headline: string | null;
  how_it_works_copy: string | null;
  profession_fit_headline: string | null;
  profession_fit_copy: string | null;
  final_cta_headline: string | null;
  final_cta_copy: string | null;
  discovery_teaser: string | null;
  short_sales_teaser: string | null;

  badges: unknown[] | null;
  trust_items: unknown[] | null;

  price_amount: number | string | null;
  price_currency: string | null;
  price_label: string | null;
  access_duration_months: number | null;
  is_subscription: boolean | null;
  offer_highlight: string | null;

  cta_primary_label: string | null;
  cta_secondary_label: string | null;
  cta_primary_url: string | null;
  cta_secondary_url: string | null;
  sticky_cta_label: string | null;
  sticky_cta_price_label: string | null;

  module_items_json: unknown[] | null;
  usp_items_json: unknown[] | null;
  how_it_works_steps_json: unknown[] | null;
  role_fit_items_json: unknown[] | null;
  faq_items_json: unknown[] | null;
  related_courses_json: unknown[] | null;
  internal_links_json: unknown[] | null;

  seo_title: string | null;
  meta_description: string | null;
  meta_keywords: string[] | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  twitter_title: string | null;
  twitter_description: string | null;
  twitter_image_url: string | null;
  robots: string | null;
  schema_product_json: Record<string, unknown> | null;
  schema_faq_json: Record<string, unknown> | null;
  schema_breadcrumb_json: Record<string, unknown> | null;

  hero_image_url: string | null;
  hero_image_alt: string | null;
  preview_image_url: string | null;
  preview_image_alt: string | null;
  simulation_image_url: string | null;
  simulation_image_alt: string | null;
  analysis_image_url: string | null;
  analysis_image_alt: string | null;
  ai_feedback_image_url: string | null;
  ai_feedback_image_alt: string | null;

  search_text: string | null;
  keyword_primary: string | null;
  keyword_secondary: string[] | null;
  keyword_longtail: string[] | null;
  domain_key: string | null;
  domain_label: string | null;
  related_professions: string[] | null;
  related_topics: string[] | null;
}
