import { useEffect } from 'react';
import { generateOrganizationSchema, generateWebSiteSchema, SITE_URL } from '@/lib/seo';

interface SEOHeadProps {
  title: string;
  description: string;
  canonical?: string;
  type?: 'website' | 'article' | 'product' | 'course';
  image?: string;
  imageAlt?: string;
  noindex?: boolean;
  structuredData?: object | object[];
  // Article-specific
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  // Product/Course specific
  price?: number;
  currency?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
}

export function SEOHead({
  title,
  description,
  canonical,
  type = 'website',
  image = '/og-image.png',
  imageAlt,
  noindex = false,
  structuredData,
  publishedTime,
  modifiedTime,
  author,
  price,
  currency = 'EUR',
  availability,
}: SEOHeadProps) {
  useEffect(() => {
    // Update document title with brand suffix
    const fullTitle = title.includes('ExamFit') ? title : `${title} | ExamFit`;
    document.title = fullTitle;

    // Update meta tags helper
    const updateMeta = (name: string, content: string, property?: boolean) => {
      const attr = property ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attr}="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    const removeMeta = (name: string, property?: boolean) => {
      const attr = property ? 'property' : 'name';
      const meta = document.querySelector(`meta[${attr}="${name}"]`);
      if (meta) meta.remove();
    };

    // Core meta tags
    updateMeta('description', description);
    
    // Robots
    if (noindex) {
      updateMeta('robots', 'noindex, nofollow');
    } else {
      updateMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    }

    // Open Graph
    const fullImage = image.startsWith('http') ? image : `${SITE_URL}${image}`;
    updateMeta('og:title', fullTitle, true);
    updateMeta('og:description', description, true);
    updateMeta('og:type', type === 'course' ? 'website' : type, true);
    updateMeta('og:image', fullImage, true);
    updateMeta('og:image:width', '1200', true);
    updateMeta('og:image:height', '630', true);
    updateMeta('og:site_name', 'ExamFit.de', true);
    updateMeta('og:locale', 'de_DE', true);
    
    if (imageAlt) {
      updateMeta('og:image:alt', imageAlt, true);
    }
    
    if (canonical) {
      updateMeta('og:url', canonical, true);
    }

    // Article-specific OG tags
    if (type === 'article') {
      if (publishedTime) {
        updateMeta('article:published_time', publishedTime, true);
      }
      if (modifiedTime) {
        updateMeta('article:modified_time', modifiedTime, true);
      }
      if (author) {
        updateMeta('article:author', author, true);
      }
    } else {
      removeMeta('article:published_time', true);
      removeMeta('article:modified_time', true);
      removeMeta('article:author', true);
    }

    // Product-specific OG tags
    if (type === 'product' && price) {
      updateMeta('product:price:amount', price.toString(), true);
      updateMeta('product:price:currency', currency, true);
      if (availability) {
        updateMeta('product:availability', availability.toLowerCase(), true);
      }
    }

    // Twitter Card
    updateMeta('twitter:card', 'summary_large_image');
    updateMeta('twitter:title', fullTitle);
    updateMeta('twitter:description', description);
    updateMeta('twitter:image', fullImage);
    if (imageAlt) {
      updateMeta('twitter:image:alt', imageAlt);
    }

    // Canonical URL
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (canonical) {
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = canonical;

      // hreflang tags for German market
      const updateHreflang = (lang: string, href: string) => {
        let el = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`) as HTMLLinkElement;
        if (!el) {
          el = document.createElement('link');
          el.rel = 'alternate';
          el.hreflang = lang;
          document.head.appendChild(el);
        }
        el.href = href;
      };
      updateHreflang('de', canonical);
      updateHreflang('x-default', canonical);
    } else if (link) {
      link.remove();
    }

    // Structured Data - remove existing and add new
    document.querySelectorAll('script[data-seo-structured]').forEach(s => s.remove());

    // Always include Organization and WebSite schema on first render
    const schemas: object[] = [
      generateOrganizationSchema(),
      generateWebSiteSchema(),
    ];

    // Add page-specific structured data
    if (structuredData) {
      if (Array.isArray(structuredData)) {
        schemas.push(...structuredData);
      } else if ((structuredData as any)['@graph']) {
        // If it's already a graph, extract the items
        schemas.push(...(structuredData as any)['@graph']);
      } else {
        schemas.push(structuredData);
      }
    }

    // Create single @graph script
    const graphData = {
      '@context': 'https://schema.org',
      '@graph': schemas.map(s => {
        // Remove @context from individual schemas since we have it at root
        const { '@context': _, ...rest } = s as any;
        return rest;
      }),
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo-structured', 'true');
    script.textContent = JSON.stringify(graphData);
    document.head.appendChild(script);

    return () => {
      document.querySelectorAll('script[data-seo-structured]').forEach(s => s.remove());
    };
  }, [title, description, canonical, type, image, imageAlt, noindex, structuredData, publishedTime, modifiedTime, author, price, currency, availability]);

  return null;
}

// Helper hook for preloading critical resources
export function useCriticalResourceHints() {
  useEffect(() => {
    const hints = [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    ];

    hints.forEach(hint => {
      const existing = document.querySelector(`link[rel="${hint.rel}"][href="${hint.href}"]`);
      if (!existing) {
        const link = document.createElement('link');
        link.rel = hint.rel;
        link.href = hint.href;
        if (hint.crossOrigin) {
          link.crossOrigin = hint.crossOrigin;
        }
        document.head.appendChild(link);
      }
    });
  }, []);
}
