import { supabase } from '@/integrations/supabase/client';

/**
 * Slugify a string for URL usage (German-aware).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolve the correct preview URL based on page type.
 */
export function resolvePagePreviewUrl(page: { slug: string; page_type: string }): string {
  switch (page.page_type) {
    case 'blog_article':
      return `/blog/${page.slug}`;
    case 'faq_page':
      return `/faq/${page.slug}`;
    case 'legal_page':
      return `/legal/${page.slug}`;
    default:
      return `/${page.slug}`;
  }
}

/**
 * Default content_json structures per block type.
 */
const BLOCK_DEFAULTS: Record<string, Record<string, any>> = {
  hero: {
    kicker: '',
    headline: 'Neue Überschrift',
    subline: 'Beschreibe hier den Nutzen.',
    primaryCtaLabel: 'Jetzt starten',
    primaryCtaUrl: '#',
    imageUrl: '',
  },
  rich_text: {
    body: '<p>Hier steht dein Text.</p>',
  },
  image: {
    src: '',
    alt: '',
    caption: '',
  },
  cta: {
    headline: 'Bereit?',
    copy: 'Starte jetzt durch.',
    buttonLabel: 'Jetzt starten',
    buttonUrl: '#',
  },
  faq: {
    items: [
      { question: 'Beispiel-Frage?', answer: 'Beispiel-Antwort.' },
    ],
  },
  trust_bar: {
    items: [
      { label: '100% digital', icon: 'check' },
      { label: 'IHK-konform', icon: 'check' },
    ],
  },
  feature_list: {
    headline: 'Vorteile',
    items: [
      { title: 'Vorteil 1', description: 'Beschreibung' },
    ],
  },
  card_grid: {
    headline: '',
    cards: [
      { title: 'Karte 1', description: 'Beschreibung', icon: '' },
    ],
  },
  steps: {
    headline: 'So funktioniert\'s',
    items: [
      { step: '1', title: 'Schritt 1', description: 'Beschreibung' },
    ],
  },
  spacer: {
    height: '48px',
  },
  video: {
    url: '',
    title: '',
  },
  testimonials: {
    items: [
      { quote: 'Tolles Produkt!', author: 'Max M.', role: 'Azubi' },
    ],
  },
  article_header: {
    title: '',
    excerpt: '',
    coverImageUrl: '',
    author: '',
    publishedAt: '',
  },
  related_articles: {
    headline: 'Verwandte Artikel',
    articleIds: [],
  },
  table_of_contents: {
    headline: 'Inhaltsverzeichnis',
    autoGenerate: true,
  },
  search: {
    placeholder: 'Suchen…',
  },
};

/**
 * Get typed default content for a block type.
 */
export function buildDefaultBlockContent(blockType: string): Record<string, any> {
  return structuredClone(BLOCK_DEFAULTS[blockType] ?? {});
}

/**
 * Create a version snapshot for a page via the DB function.
 */
export async function snapshotPageVersion(pageId: string, userId?: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc('snapshot_page_version', {
    p_page_id: pageId,
    p_created_by: userId ?? null,
  });
  if (error) {
    console.error('Snapshot failed:', error);
    return null;
  }
  return data as string;
}

/**
 * Check if a slug is already taken by another page.
 */
export async function isSlugTaken(slug: string, excludePageId?: string): Promise<boolean> {
  let query = (supabase as any)
    .from('cms_pages')
    .select('id')
    .eq('slug', slug)
    .limit(1);
  if (excludePageId) {
    query = query.neq('id', excludePageId);
  }
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}
