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
  debug?: boolean;
}): string {
  if (opts.explicit && opts.explicit.trim().length > 0) {
    if (opts.debug) console.log('[resolveCourseImage] explicit:', opts.explicit);
    return opts.explicit;
  }
  const fallback = getBerufImage(opts.title ?? '', opts.chamber ?? null);
  if (opts.debug) {
    console.warn(
      `[resolveCourseImage] Fallback triggered — title:"${opts.title ?? ''}" chamber:"${opts.chamber ?? ''}" → ${fallback}`
    );
  }
  return fallback;
}

/**
 * Default sizes-Hinweis für responsive Karten in 1/2/3-Spalten-Grids.
 * Wird auch ohne srcSet vom Browser für die Wahl von Preload-Hints genutzt.
 */
export const COURSE_CARD_SIZES =
  '(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw';

/**
 * PDP-Hero-Bild: Container ist max-w-6xl (1152px) mit 2-Spalten-Grid ab md.
 * Mobile: füllt Viewport (Hero ist `order-first` → LCP-Kandidat).
 * Tablet/md: ~45vw pro Spalte. Desktop ≥ Container-Breite: feste 560px.
 */
export const COURSE_HERO_SIZES =
  '(min-width: 1152px) 560px, (min-width: 768px) 45vw, 100vw';
