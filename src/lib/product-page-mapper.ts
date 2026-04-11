import type {
  FAQItem,
  HowItWorksStep,
  InternalLinkItem,
  ProductBadge,
  ProductModuleItem,
  ProductPageSSOT,
  RelatedCourseItem,
  RoleFitItem,
  TrustItem,
  USPItem,
} from '@/types/product-page';
import type { ProductPageSSOTRow } from '@/types/product-page-db';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function mapBadges(value: unknown): ProductBadge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ label: item }];
    if (item && typeof item === 'object' && 'label' in item) {
      const label = asString((item as Record<string, unknown>).label);
      return label ? [{ label }] : [];
    }
    return [];
  });
}

function mapTrustItems(value: unknown): TrustItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ label: item }];
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const label = asString(obj.label);
      if (!label) return [];
      return [{ label, icon: asNullableString(obj.icon) }];
    }
    return [];
  });
}

function mapModules(value: unknown): ProductModuleItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const key = asString(obj.key);
    const title = asString(obj.title);
    const copy = asString(obj.copy);
    if (!key || !title || !copy) return [];
    return [{ key, title, copy, icon: asNullableString(obj.icon) }];
  });
}

function mapUSPItems(value: unknown): USPItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const title = asString(obj.title);
    const copy = asString(obj.copy);
    if (!title || !copy) return [];
    return [{ title, copy }];
  });
}

function mapHowItWorksSteps(value: unknown): HowItWorksStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const step = asNumber(obj.step, 0);
    const title = asString(obj.title);
    const copy = asString(obj.copy);
    if (!step || !title || !copy) return [];
    return [{ step, title, copy }];
  });
}

function mapRoleFitItems(value: unknown): RoleFitItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ title: item }];
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const title = asString(obj.title);
    if (!title) return [];
    return [{ title, copy: asNullableString(obj.copy) }];
  });
}

function mapFAQItems(value: unknown): FAQItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const question = asString(obj.question);
    const answer = asString(obj.answer);
    if (!question || !answer) return [];
    return [{ question, answer }];
  });
}

function mapRelatedCourses(value: unknown): RelatedCourseItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const slug = asString(obj.slug);
    const title = asString(obj.title);
    if (!slug || !title) return [];
    return [
      {
        slug,
        title,
        teaser: asNullableString(obj.teaser),
        domainLabel: asNullableString(obj.domainLabel ?? obj.domain_label),
        kammer: asNullableString(obj.kammer),
      },
    ];
  });
}

function mapInternalLinks(value: unknown): InternalLinkItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const label = asString(obj.label);
    const url = asString(obj.url);
    if (!label || !url) return [];
    return [{ label, url }];
  });
}

export function mapProductPageSSOT(row: ProductPageSSOTRow): ProductPageSSOT {
  return {
    packageId: row.package_id,
    courseId: row.course_id,
    curriculumId: row.curriculum_id,
    berufId: row.beruf_id,

    canonicalSlug: row.canonical_slug,
    canonicalUrl: row.canonical_url,
    canonicalTitle: row.canonical_title,
    canonicalTitleNorm: row.canonical_title_norm,
    productType: 'pruefungstraining',
    status: (row.status as ProductPageSSOT['status']) ?? 'draft',
    publishedAt: row.published_at,
    updatedAt: row.updated_at,

    berufDisplayName: row.beruf_display_name,
    berufKurz: row.beruf_kurz,
    berufLang: row.beruf_lang,
    kammer: row.kammer,
    track: row.track,
    curriculumTrack: row.curriculum_track,
    personaProfile: row.persona_profile,
    examFocus: (row.exam_focus as ProductPageSSOT['examFocus']) ?? 'unbekannt',
    domainKey: row.domain_key ?? 'ausbildung',
    domainLabel: row.domain_label,

    capabilities: {
      examModeAvailable: Boolean(row.exam_mode_available),
      oralModeAvailable: Boolean(row.oral_mode_available),
      aiTutorAvailable: Boolean(row.ai_tutor_available),
      handbookAvailable: Boolean(row.handbook_available),
      minichecksAvailable: Boolean(row.minichecks_available),
    },

    heroHeadline: row.hero_headline ?? row.canonical_title,
    heroSubline: row.hero_subline ?? '',
    heroKicker: row.hero_kicker,
    productIntro: row.product_intro,
    painHeadline: row.pain_headline,
    painCopy: row.pain_copy,
    uspHeadline: row.usp_headline,
    uspCopy: row.usp_copy,
    howItWorksHeadline: row.how_it_works_headline,
    howItWorksCopy: row.how_it_works_copy,
    professionFitHeadline: row.profession_fit_headline,
    professionFitCopy: row.profession_fit_copy,
    finalCtaHeadline: row.final_cta_headline,
    finalCtaCopy: row.final_cta_copy,
    discoveryTeaser: row.discovery_teaser,
    shortSalesTeaser: row.short_sales_teaser,

    badges: mapBadges(row.badges),
    trustItems: mapTrustItems(row.trust_items),

    pricing: {
      amount: asNumber(row.price_amount, 24.9),
      currency: row.price_currency ?? 'EUR',
      label: row.price_label ?? 'Einmalzahlung',
      accessDurationMonths: row.access_duration_months ?? 12,
      isSubscription: Boolean(row.is_subscription),
      offerHighlight: row.offer_highlight,
    },

    ctas: {
      primaryLabel: row.cta_primary_label ?? 'Jetzt Prüfungstraining starten',
      secondaryLabel: row.cta_secondary_label,
      primaryUrl: row.cta_primary_url ?? `/checkout/${row.canonical_slug}`,
      secondaryUrl: row.cta_secondary_url,
      stickyLabel: row.sticky_cta_label ?? 'Prüfungstraining starten',
      stickyPriceLabel: row.sticky_cta_price_label,
    },

    modules: mapModules(row.module_items_json),
    uspItems: mapUSPItems(row.usp_items_json),
    howItWorksSteps: mapHowItWorksSteps(row.how_it_works_steps_json),
    roleFitItems: mapRoleFitItems(row.role_fit_items_json),
    faqItems: mapFAQItems(row.faq_items_json),
    relatedCourses: mapRelatedCourses(row.related_courses_json),
    internalLinks: mapInternalLinks(row.internal_links_json),

    seo: {
      title: row.seo_title ?? row.canonical_title,
      metaDescription: row.meta_description ?? '',
      metaKeywords: row.meta_keywords ?? [],
      ogTitle: row.og_title ?? row.seo_title ?? row.canonical_title,
      ogDescription: row.og_description ?? row.meta_description ?? '',
      ogImageUrl: row.og_image_url,
      twitterTitle: row.twitter_title ?? row.og_title ?? row.seo_title ?? row.canonical_title,
      twitterDescription: row.twitter_description ?? row.og_description ?? row.meta_description ?? '',
      twitterImageUrl: row.twitter_image_url ?? row.og_image_url,
      robots: row.robots ?? 'index,follow',
      canonicalUrl: row.canonical_url,
      schemaProductJson: row.schema_product_json,
      schemaFaqJson: row.schema_faq_json,
      schemaBreadcrumbJson: row.schema_breadcrumb_json,
    },

    images: {
      heroImageUrl: row.hero_image_url,
      heroImageAlt: row.hero_image_alt,
      previewImageUrl: row.preview_image_url,
      previewImageAlt: row.preview_image_alt,
      simulationImageUrl: row.simulation_image_url,
      simulationImageAlt: row.simulation_image_alt,
      analysisImageUrl: row.analysis_image_url,
      analysisImageAlt: row.analysis_image_alt,
      aiFeedbackImageUrl: row.ai_feedback_image_url,
      aiFeedbackImageAlt: row.ai_feedback_image_alt,
    },

    searchText: row.search_text ?? '',
    keywordPrimary: row.keyword_primary,
    keywordSecondary: row.keyword_secondary ?? [],
    keywordLongtail: row.keyword_longtail ?? [],
    relatedProfessions: row.related_professions ?? [],
    relatedTopics: row.related_topics ?? [],
  };
}
