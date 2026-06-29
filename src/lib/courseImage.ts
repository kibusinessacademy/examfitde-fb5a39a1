import { getBerufImage } from '@/lib/berufImage';

/**
 * Einheitliche Bild-Auflösung für Kursvisuals (PDP-Hero + Karten).
 * Reihenfolge: explizites Hero-Bild → berufspassendes Fallback → harter Default
 * via getBerufImage. Liefert IMMER eine gültige Bild-URL — nie undefined.
 */
export function resolveCourseImage(opts: {
  explicit?: string | null;
  title?: string | null;
  chamber?: string | null;
}): string {
  if (opts.explicit && opts.explicit.trim().length > 0) return opts.explicit;
  return getBerufImage(opts.title ?? '', opts.chamber ?? null);
}

/**
 * Default sizes-Hinweis für responsive Karten in 1/2/3-Spalten-Grids.
 * Wird auch ohne srcSet vom Browser für die Wahl von Preload-Hints genutzt.
 */
export const COURSE_CARD_SIZES =
  '(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw';

export const COURSE_HERO_SIZES =
  '(min-width: 768px) 560px, 100vw';
