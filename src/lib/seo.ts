// SEO utility functions and structured data generators
// Optimized for Google Search Guidelines 2025

export const SITE_URL = 'https://examfit.de';
export const SITE_NAME = 'ExamFit';
export const SITE_LEGAL_NAME = 'ExamFit.de';
export const DEFAULT_OG_IMAGE = '/og-image.png';

/** Current year for SEO titles — auto-updates every year */
export const CURRENT_YEAR = new Date().getFullYear();

/** Build a CTR-optimized SEO title with auto-updating year */
export function seoTitle(base: string, options?: { year?: boolean; suffix?: string }): string {
  const year = options?.year !== false ? ` (${CURRENT_YEAR})` : '';
  const suffix = options?.suffix ?? ' | ExamFit';
  return `${base}${year}${suffix}`;
}

// URL slug generator with German umlaut handling
export function generateSlug(text: string): string {
  const charMap: Record<string, string> = {
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
    'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue',
  };

  return text
    .toLowerCase()
    .split('')
    .map(char => charMap[char] || char)
    .join('')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// SEO-optimized image filename generator
export function generateImageFilename(options: {
  subject: string;
  productType?: 'lernkurs' | 'pruefungstrainer' | 'bundle';
  format?: 'og' | 'twitter' | 'app-store' | 'play-store' | 'square' | 'banner';
}): string {
  const { subject, productType, format } = options;
  const slug = generateSlug(subject);
  const parts = [slug];
  
  if (productType) {
    parts.push(productType);
  }
  
  if (format) {
    parts.push(format);
  }
  
  return `${parts.join('-')}.webp`;
}

// SEO-optimized alt text generator
export function generateAltText(options: {
  subject: string;
  productType?: 'lernkurs' | 'pruefungstrainer' | 'bundle';
  context?: string;
}): string {
  const { subject, productType, context } = options;
  
  const productLabels = {
    lernkurs: 'Lernkurs',
    pruefungstrainer: 'Prüfungstrainer',
    bundle: 'Komplett-Bundle',
  };
  
  let alt = subject;
  
  if (productType) {
    alt = `${subject} ${productLabels[productType]} für IHK-Prüfungsvorbereitung`;
  }
  
  if (context) {
    alt = `${alt} - ${context}`;
  }
  
  return alt;
}

// Enhanced Course Schema with CourseInstance (Google 2025 standard)
export function generateCourseSchema(course: {
  id: string;
  name: string;
  description: string;
  provider?: string;
  url?: string;
  image?: string;
  price?: number;
  currency?: string;
  duration?: string; // ISO 8601 duration e.g. "PT12M" for 12 months
  courseMode?: 'online' | 'onsite' | 'blended';
  educationalLevel?: string;
  inLanguage?: string;
  coursePrerequisites?: string;
  numberOfLessons?: number;
  hasCertificate?: boolean;
}) {
  const baseSchema = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': `${SITE_URL}/kurse/${course.id}`,
    name: course.name,
    description: course.description,
    provider: {
      '@type': 'EducationalOrganization',
      name: course.provider || SITE_NAME,
      sameAs: SITE_URL,
      url: SITE_URL,
    },
    url: course.url || SITE_URL,
    image: course.image || `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    inLanguage: course.inLanguage || 'de',
    educationalLevel: course.educationalLevel || 'Berufsausbildung (DQR 4)',
    isAccessibleForFree: false,
    ...(course.coursePrerequisites && { coursePrerequisites: course.coursePrerequisites }),
    ...(course.numberOfLessons && { numberOfCredits: course.numberOfLessons }),
    ...(course.hasCertificate && {
      educationalCredentialAwarded: {
        '@type': 'EducationalOccupationalCredential',
        name: 'Teilnahmezertifikat',
        credentialCategory: 'Certificate',
      },
    }),
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: course.courseMode || 'online',
      courseWorkload: course.duration || 'P12M',
      instructor: {
        '@type': 'Organization',
        name: SITE_NAME,
      },
    },
    ...(course.price && {
      offers: {
        '@type': 'Offer',
        price: course.price,
        priceCurrency: course.currency || 'EUR',
        availability: 'https://schema.org/InStock',
        validFrom: new Date().toISOString().split('T')[0],
        priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        seller: {
          '@type': 'Organization',
          name: SITE_NAME,
        },
      },
    }),
  };

  return baseSchema;
}

// LearningResource Schema (Google recommended for educational content)
export function generateLearningResourceSchema(resource: {
  name: string;
  description: string;
  url: string;
  learningResourceType: 'lesson' | 'quiz' | 'exercise' | 'video' | 'article';
  educationalLevel?: string;
  timeRequired?: string;
  isPartOf?: string;
}) {
  const typeMap = {
    lesson: 'Lesson',
    quiz: 'Quiz',
    exercise: 'Exercise',
    video: 'VideoObject',
    article: 'Article',
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: resource.name,
    description: resource.description,
    url: resource.url,
    learningResourceType: typeMap[resource.learningResourceType],
    educationalLevel: resource.educationalLevel || 'Berufsausbildung',
    inLanguage: 'de',
    ...(resource.timeRequired && { timeRequired: resource.timeRequired }),
    ...(resource.isPartOf && {
      isPartOf: {
        '@type': 'Course',
        '@id': resource.isPartOf,
      },
    }),
    provider: {
      '@type': 'EducationalOrganization',
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

// ItemList Schema for Course Lists (enables Course Carousel in Google)
export function generateCourseListSchema(courses: Array<{
  name: string;
  url: string;
  description: string;
  image?: string;
  price?: number;
}>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: courses.map((course, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Course',
        name: course.name,
        description: course.description,
        url: course.url,
        image: course.image || `${SITE_URL}${DEFAULT_OG_IMAGE}`,
        provider: {
          '@type': 'EducationalOrganization',
          name: SITE_NAME,
        },
        ...(course.price && {
          offers: {
            '@type': 'Offer',
            price: course.price,
            priceCurrency: 'EUR',
          },
        }),
      },
    })),
  };
}

// Enhanced Product Schema with Aggregate Rating support
export function generateProductSchema(product: {
  name: string;
  description: string;
  price: number;
  currency?: string;
  image?: string;
  url?: string;
  sku?: string;
  brand?: string;
  ratingValue?: number;
  reviewCount?: number;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.image || `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    url: product.url || SITE_URL,
    brand: {
      '@type': 'Brand',
      name: product.brand || SITE_NAME,
    },
    sku: product.sku,
    ...(product.ratingValue && product.reviewCount && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.ratingValue,
        reviewCount: product.reviewCount,
        bestRating: 5,
        worstRating: 1,
      },
    }),
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency || 'EUR',
      availability: `https://schema.org/${product.availability || 'InStock'}`,
      priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      seller: {
        '@type': 'Organization',
        name: SITE_NAME,
      },
    },
  };
}

export function generateFAQSchema(faqs: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

// Enhanced Organization Schema with more Google-recommended properties
export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/logo.png`,
      width: 512,
      height: 512,
    },
    // HINWEIS: "IHK" nur beschreibend, nicht als Partner/Zertifikation
    description: 'Unabhängige Lernplattform zur Prüfungsvorbereitung für Auszubildende in Deutschland',
    foundingDate: '2023-01-01',
    areaServed: {
      '@type': 'Country',
      name: 'Germany',
    },
    sameAs: [
      'https://www.linkedin.com/company/examfit',
      'https://www.instagram.com/examfit_de',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      availableLanguage: 'German',
      email: 'support@examfit.de',
    },
  };
}

// WebSite Schema with SearchAction (enables Sitelinks Searchbox)
export function generateWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: 'Prüfungsvorbereitung mit KI-Unterstützung',
    publisher: {
      '@id': `${SITE_URL}/#organization`,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/suche?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
    inLanguage: 'de-DE',
  };
}

export function generateBreadcrumbSchema(items: Array<{ name: string; url?: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url && { item: item.url }),
    })),
  };
}

// Article Schema for Blog/Wissen content
export function generateArticleSchema(article: {
  title: string;
  description: string;
  url: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
  wordCount?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    url: article.url,
    image: article.image || `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      '@type': 'Organization',
      name: article.author || SITE_NAME,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': article.url,
    },
    inLanguage: 'de-DE',
    ...(article.wordCount && { wordCount: article.wordCount }),
  };
}

// How-To Schema for tutorial content
export function generateHowToSchema(howTo: {
  name: string;
  description: string;
  totalTime?: string;
  steps: Array<{ name: string; text: string; image?: string }>;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: howTo.name,
    description: howTo.description,
    ...(howTo.totalTime && { totalTime: howTo.totalTime }),
    step: howTo.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.name,
      text: step.text,
      ...(step.image && { image: step.image }),
    })),
  };
}

// SEO content templates
// WICHTIG: "IHK" nur beschreibend verwenden, nicht als offizieller Partner/Zertifikation
// questionLabel: dynamisch z.B. "600+" oder "1.000+" je nach Ausbildungsdauer
export const SEO_TEMPLATES = {
  ihkPruefung: (beruf: string, questionLabel?: string) => ({
    title: `${beruf} Prüfung bestehen | ExamFit`,
    description: `Bereite dich optimal auf die Abschlussprüfung ${beruf} vor. ${questionLabel ? `${questionLabel} Prüfungsfragen, ` : ''}Intelligentes Prüfungstraining mit Simulation, KI-Tutor & mündlicher Prüfung. Jetzt starten!`,
  }),
  lernkurs: (beruf: string, questionLabel?: string) => ({
    title: `${beruf} Prüfungstraining | Prüfungswissen | ExamFit`,
    description: `Prüfungsrelevantes Wissen für ${beruf}. Alle Lernfelder, ${questionLabel ? `${questionLabel} Übungsfragen, ` : ''}gezielt aufbereitet für die Abschlussprüfung. 12 Monate Zugang.`,
  }),
  pruefungstrainer: (beruf: string, questionLabel?: string) => ({
    title: `${beruf} Prüfungstrainer | Aufgaben üben | ExamFit`,
    description: `Trainiere mit ${questionLabel || 'prüfungsrelevanten'} Aufgaben für ${beruf}. Adaptive Schwächenanalyse & Prüfungssimulation.`,
  }),
  bundle: (beruf: string, questionLabel?: string) => ({
    title: `${beruf} Prüfungstraining komplett | ExamFit`,
    description: `Das komplette Prüfungstraining für ${beruf}: ${questionLabel ? `${questionLabel} Fragen, ` : ''}Prüfungswissen + Simulation + mündliche Prüfung. Alles in einem Paket.`,
  }),
  beruf: (beruf: string, kammer: string = 'IHK', questionLabel?: string) => ({
    title: `${beruf} – ${kammer}-Prüfung & Vorbereitung | ExamFit`,
    description: `Alles zur Ausbildung ${beruf}: Berufsbild, ${kammer}-Prüfungsstruktur${questionLabel ? `, ${questionLabel} Prüfungsfragen` : ''}, typische Fehler & optimale Vorbereitung. Jetzt informieren!`,
  }),
  wissen: (topic: string) => ({
    title: `${topic} | Prüfungswissen | ExamFit`,
    description: `${topic} – Expertenwissen für deine Abschlussprüfung. Praktische Tipps, Lernstrategien & bewährte Methoden.`,
  }),
};

// Product pricing — single product
export const PRODUCT_PRICES = {
  pruefungstraining: 39,
  // Legacy keys kept for backward compatibility
  lernkurs: 39,
  pruefungstrainer: 39,
  bundle: 39,
} as const;

// URL structure helpers
export function getBerufUrl(slug: string, product?: 'lernkurs' | 'pruefungstrainer' | 'bundle') {
  if (!product) return `/berufe/${slug}`;
  return `/${product === 'bundle' ? 'bundle' : product}/${slug}`;
}

export function getIHKPruefungUrl(slug: string) {
  return `/ihk-pruefungen/${slug}`;
}

export function getWissenUrl(category: string, slug: string) {
  return `/wissen/${category}/${slug}`;
}

// Sitemap URL entry type
export interface SitemapURL {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  images?: Array<{
    loc: string;
    title?: string;
    caption?: string;
  }>;
}

// Generate XML sitemap string
export function generateSitemapXML(urls: SitemapURL[]): string {
  const urlEntries = urls.map(url => {
    let entry = `  <url>\n    <loc>${url.loc}</loc>\n`;
    
    if (url.lastmod) {
      entry += `    <lastmod>${url.lastmod}</lastmod>\n`;
    }
    if (url.changefreq) {
      entry += `    <changefreq>${url.changefreq}</changefreq>\n`;
    }
    if (url.priority !== undefined) {
      entry += `    <priority>${url.priority.toFixed(1)}</priority>\n`;
    }
    
    // Image sitemap extension
    if (url.images && url.images.length > 0) {
      url.images.forEach(img => {
        entry += `    <image:image>\n`;
        entry += `      <image:loc>${img.loc}</image:loc>\n`;
        if (img.title) {
          entry += `      <image:title>${escapeXml(img.title)}</image:title>\n`;
        }
        if (img.caption) {
          entry += `      <image:caption>${escapeXml(img.caption)}</image:caption>\n`;
        }
        entry += `    </image:image>\n`;
      });
    }
    
    entry += `  </url>`;
    return entry;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlEntries}
</urlset>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Core Web Vitals optimization hints
export const PERFORMANCE_HINTS = {
  // Image optimization
  imageFormats: ['webp', 'avif'] as const,
  imageSizes: {
    thumbnail: { width: 150, height: 150 },
    card: { width: 400, height: 300 },
    og: { width: 1200, height: 630 },
    twitter: { width: 1200, height: 600 },
    appStore: { width: 1024, height: 1024 },
    playStore: { width: 512, height: 512 },
    featureGraphic: { width: 1024, height: 500 },
  },
  // Preload hints for critical resources
  criticalResources: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
  ],
};
