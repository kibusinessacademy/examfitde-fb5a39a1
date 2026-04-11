export type ProductStatus = 'draft' | 'building' | 'published' | 'blocked' | 'archived';

export type ProductType = 'pruefungstraining';

export type ExamFocus =
  | 'schriftlich'
  | 'muendlich'
  | 'schriftlich_und_muendlich'
  | 'unbekannt';

export type DomainKey =
  | 'ausbildung'
  | 'studium'
  | 'fortbildung'
  | 'zertifizierung'
  | string;

export interface ProductBadge {
  label: string;
}

export interface TrustItem {
  label: string;
  icon?: string | null;
}

export interface ProductModuleItem {
  key: string;
  title: string;
  copy: string;
  icon?: string | null;
}

export interface USPItem {
  title: string;
  copy: string;
}

export interface HowItWorksStep {
  step: number;
  title: string;
  copy: string;
}

export interface RoleFitItem {
  title: string;
  copy?: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface RelatedCourseItem {
  slug: string;
  title: string;
  teaser?: string | null;
  domainLabel?: string | null;
  kammer?: string | null;
}

export interface InternalLinkItem {
  label: string;
  url: string;
}

export interface ProductImageSet {
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  previewImageUrl: string | null;
  previewImageAlt: string | null;
  simulationImageUrl: string | null;
  simulationImageAlt: string | null;
  analysisImageUrl: string | null;
  analysisImageAlt: string | null;
  aiFeedbackImageUrl: string | null;
  aiFeedbackImageAlt: string | null;
}

export interface ProductSEO {
  title: string;
  metaDescription: string;
  metaKeywords: string[];
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string | null;
  twitterTitle: string;
  twitterDescription: string;
  twitterImageUrl: string | null;
  robots: string;
  canonicalUrl: string;
  schemaProductJson: Record<string, unknown> | null;
  schemaFaqJson: Record<string, unknown> | null;
  schemaBreadcrumbJson: Record<string, unknown> | null;
}

export interface ProductCTAConfig {
  primaryLabel: string;
  secondaryLabel: string | null;
  primaryUrl: string;
  secondaryUrl: string | null;
  stickyLabel: string;
  stickyPriceLabel: string | null;
}

export interface ProductPricing {
  amount: number;
  currency: string;
  label: string;
  accessDurationMonths: number;
  isSubscription: boolean;
  offerHighlight: string | null;
}

export interface ProductCapabilities {
  examModeAvailable: boolean;
  oralModeAvailable: boolean;
  aiTutorAvailable: boolean;
  handbookAvailable: boolean;
  minichecksAvailable: boolean;
}

export interface ProductPageSSOT {
  packageId: string;
  courseId: string | null;
  curriculumId: string;
  berufId: string | null;

  canonicalSlug: string;
  canonicalUrl: string;
  canonicalTitle: string;
  canonicalTitleNorm: string | null;
  productType: ProductType;
  status: ProductStatus;
  publishedAt: string | null;
  updatedAt: string | null;

  berufDisplayName: string | null;
  berufKurz: string | null;
  berufLang: string | null;
  kammer: string | null;
  track: string | null;
  curriculumTrack: string | null;
  personaProfile: string | null;
  examFocus: ExamFocus;
  domainKey: DomainKey;
  domainLabel: string | null;

  capabilities: ProductCapabilities;

  heroHeadline: string;
  heroSubline: string;
  heroKicker: string | null;
  productIntro: string | null;
  painHeadline: string | null;
  painCopy: string | null;
  uspHeadline: string | null;
  uspCopy: string | null;
  howItWorksHeadline: string | null;
  howItWorksCopy: string | null;
  professionFitHeadline: string | null;
  professionFitCopy: string | null;
  finalCtaHeadline: string | null;
  finalCtaCopy: string | null;
  discoveryTeaser: string | null;
  shortSalesTeaser: string | null;

  badges: ProductBadge[];
  trustItems: TrustItem[];
  pricing: ProductPricing;
  ctas: ProductCTAConfig;

  modules: ProductModuleItem[];
  uspItems: USPItem[];
  howItWorksSteps: HowItWorksStep[];
  roleFitItems: RoleFitItem[];
  faqItems: FAQItem[];
  relatedCourses: RelatedCourseItem[];
  internalLinks: InternalLinkItem[];

  seo: ProductSEO;
  images: ProductImageSet;

  searchText: string;
  keywordPrimary: string | null;
  keywordSecondary: string[];
  keywordLongtail: string[];
  relatedProfessions: string[];
  relatedTopics: string[];
}
