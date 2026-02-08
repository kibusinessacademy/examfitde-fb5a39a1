// SEO utility functions and structured data generators

export const SITE_URL = 'https://examfit.de';
export const SITE_NAME = 'ExamFit';
export const DEFAULT_OG_IMAGE = '/og-image.png';

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

// Structured data generators
export function generateCourseSchema(course: {
  name: string;
  description: string;
  provider?: string;
  url?: string;
  image?: string;
  price?: number;
  currency?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.name,
    description: course.description,
    provider: {
      '@type': 'Organization',
      name: course.provider || SITE_NAME,
      sameAs: SITE_URL,
    },
    url: course.url || SITE_URL,
    image: course.image || DEFAULT_OG_IMAGE,
    ...(course.price && {
      offers: {
        '@type': 'Offer',
        price: course.price,
        priceCurrency: course.currency || 'EUR',
        availability: 'https://schema.org/InStock',
      },
    }),
  };
}

export function generateProductSchema(product: {
  name: string;
  description: string;
  price: number;
  currency?: string;
  image?: string;
  url?: string;
  sku?: string;
  brand?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.image || DEFAULT_OG_IMAGE,
    url: product.url || SITE_URL,
    brand: {
      '@type': 'Brand',
      name: product.brand || SITE_NAME,
    },
    sku: product.sku,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency || 'EUR',
      availability: 'https://schema.org/InStock',
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

export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    description: 'KI-gestützte IHK-Prüfungsvorbereitung für Auszubildende in Deutschland',
    sameAs: [
      'https://www.linkedin.com/company/examfit',
      'https://www.instagram.com/examfit_de',
    ],
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

// SEO content templates
export const SEO_TEMPLATES = {
  ihkPruefung: (beruf: string) => ({
    title: `${beruf} IHK-Prüfung bestehen | ExamFit`,
    description: `Bereite dich optimal auf die IHK-Prüfung ${beruf} vor. Interaktive Lernkurse, Prüfungstrainer & mündliche Prüfungssimulation. Jetzt starten!`,
  }),
  lernkurs: (beruf: string) => ({
    title: `${beruf} Lernkurs | IHK-Prüfungsvorbereitung | ExamFit`,
    description: `Strukturierter Lernkurs für ${beruf}. Alle Lernfelder, interaktive H5P-Module & KI-Tutor. 12 Monate Zugang für nur 19€.`,
  }),
  pruefungstrainer: (beruf: string) => ({
    title: `${beruf} Prüfungstrainer | IHK-Fragen üben | ExamFit`,
    description: `Trainiere mit echten IHK-Prüfungsfragen für ${beruf}. Adaptive Lernalgorithmen, Schwachstellen-Analyse & Prüfungssimulation. 29€.`,
  }),
  bundle: (beruf: string) => ({
    title: `${beruf} Komplett-Paket | Lernen + Üben | ExamFit`,
    description: `Das Komplett-Paket für ${beruf}: Lernkurs + Prüfungstrainer + mündliche Prüfungssimulation. Alles in einem für nur 39€.`,
  }),
  beruf: (beruf: string) => ({
    title: `${beruf} – Ausbildung, IHK-Prüfung & Vorbereitung | ExamFit`,
    description: `Alles zur Ausbildung ${beruf}: Berufsbild, Prüfungsstruktur, typische Fehler & optimale Vorbereitung. Jetzt informieren!`,
  }),
  wissen: (topic: string) => ({
    title: `${topic} | IHK-Prüfungswissen | ExamFit`,
    description: `${topic} – Expertenwissen für deine IHK-Prüfung. Praktische Tipps, Lernstrategien & bewährte Methoden.`,
  }),
};

// Product pricing
export const PRODUCT_PRICES = {
  lernkurs: 19,
  pruefungstrainer: 29,
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
