/**
 * Product Page SEO Builder (SSOT)
 * 
 * Centralizes ALL SEO concerns for product pages.
 * No SEO logic should leak into section components.
 */
import type { ProductPageSSOT } from '@/types/product-page';
import { SITE_URL } from '@/lib/seo';

interface ProductSEOOutput {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string | null;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string | null;
  structuredData: object[];
}

export function buildProductSEO(product: ProductPageSSOT): ProductSEOOutput {
  const schemas: object[] = [];

  // Product schema from DB or fallback
  if (product.seo.schemaProductJson) {
    schemas.push(product.seo.schemaProductJson);
  } else {
    schemas.push({
      '@type': 'Product',
      name: product.canonicalTitle,
      description: product.seo.metaDescription,
      url: product.seo.canonicalUrl,
      image: product.seo.ogImageUrl || `${SITE_URL}/og-image.png`,
      brand: { '@type': 'Brand', name: 'ExamFit' },
      offers: {
        '@type': 'Offer',
        price: product.pricing.amount,
        priceCurrency: product.pricing.currency,
        availability: 'https://schema.org/InStock',
        priceValidUntil: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
        seller: { '@type': 'Organization', name: 'ExamFit' },
      },
    });
  }

  // FAQ schema
  if (product.faqItems.length > 0) {
    if (product.seo.schemaFaqJson) {
      schemas.push(product.seo.schemaFaqJson);
    } else {
      schemas.push({
        '@type': 'FAQPage',
        mainEntity: product.faqItems.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      });
    }
  }

  // Breadcrumb schema
  if (product.seo.schemaBreadcrumbJson) {
    schemas.push(product.seo.schemaBreadcrumbJson);
  } else {
    schemas.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Prüfungstraining', item: `${SITE_URL}/pruefungstraining` },
        { '@type': 'ListItem', position: 3, name: product.canonicalTitle },
      ],
    });
  }

  return {
    title: product.seo.title,
    description: product.seo.metaDescription,
    canonical: product.seo.canonicalUrl,
    robots: product.seo.robots,
    ogTitle: product.seo.ogTitle,
    ogDescription: product.seo.ogDescription,
    ogImage: product.seo.ogImageUrl,
    twitterTitle: product.seo.twitterTitle,
    twitterDescription: product.seo.twitterDescription,
    twitterImage: product.seo.twitterImageUrl,
    structuredData: schemas,
  };
}
