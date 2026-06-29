import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveBerufAltText } from '@/lib/berufAltText';

export type BerufImageItem = { slug: string; title: string; kammer?: string | null };

type CacheRow = { slug: string; status: string; image_url: string | null; alt_text: string | null; error: string | null; title: string | null };

/**
 * useBerufImages — Lazy per-slug image cache.
 *
 * Strategy:
 *  1. Read existing cache rows for the visible slugs (public RLS).
 *  2. Trigger the `generate-beruf-image` edge function in batch for missing slugs.
 *     Edge fn marks them `pending` and generates async via Lovable AI Gateway.
 *  3. Poll cache every 6s while any slug is still pending → swap-in URLs as they arrive.
 *
 * Returns `imageBySlug` map; consumer should fall back to a category bucket image
 * via `getBerufImage()` until the real photo is ready.
 */
export function useBerufImages(items: BerufImageItem[]) {
  const qc = useQueryClient();
  const slugs = useMemo(() => items.map((i) => i.slug).filter(Boolean).sort(), [items]);
  const slugsKey = slugs.join('|');
  const [triggered, setTriggered] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['beruf-image-cache', slugsKey],
    enabled: slugs.length > 0,
    refetchInterval: (q) => {
      const rows = (q.state.data as CacheRow[] | undefined) ?? [];
      const ready = new Set(rows.filter((r) => r.status === 'ready' && r.image_url).map((r) => r.slug));
      const allDone = slugs.every((s) => ready.has(s));
      return allDone ? false : 8000;
    },
    queryFn: async (): Promise<CacheRow[]> => {
      const { data, error } = await supabase
        .from('beruf_image_cache')
        .select('slug,status,image_url,alt_text,error,title')
        .in('slug', slugs);
      if (error) throw error;
      return (data ?? []) as CacheRow[];
    },
  });

  // Kick off generation for any missing slugs (deduped via `triggered` set)
  useEffect(() => {
    if (!slugs.length) return;
    const rows = (data ?? []) as CacheRow[];
    const known = new Map(rows.map((r) => [r.slug, r]));
    const missing = items.filter((it) => {
      if (triggered.has(it.slug)) return false;
      const r = known.get(it.slug);
      return !r || (r.status === 'failed') || (r.status !== 'ready' && !r.image_url);
    });
    if (!missing.length) return;

    // Chunk to avoid huge payloads — process 24 at a time
    const chunkSize = 24;
    const chunks: BerufImageItem[][] = [];
    for (let i = 0; i < missing.length; i += chunkSize) {
      chunks.push(missing.slice(i, i + chunkSize));
    }

    setTriggered((prev) => {
      const next = new Set(prev);
      for (const it of missing) next.add(it.slug);
      return next;
    });

    (async () => {
      for (const chunk of chunks) {
        try {
          await supabase.functions.invoke('generate-beruf-image', {
            body: {
              items: chunk.map((c) => ({ slug: c.slug, title: c.title, kammer: c.kammer ?? null })),
            },
          });
        } catch (e) {
          console.warn('[useBerufImages] queue failed', e);
        }
      }
      // Nudge re-fetch sooner
      qc.invalidateQueries({ queryKey: ['beruf-image-cache', slugsKey] });
    })();
  }, [data, items, slugs, slugsKey, triggered, qc]);

  const imageBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (data ?? []) as CacheRow[]) {
      if (r.status === 'ready' && r.image_url) m.set(r.slug, r.image_url);
    }
    return m;
  }, [data]);

  /**
   * Alt-Text pro Slug — vom Edge-Generator gebaut (deutsch, Berufskontext,
   * inkl. Auszubildende-Begriff). Falls die Edge-Function noch keinen
   * Alt-Text geschrieben hat, fällt `resolveBerufAltText` deterministisch
   * auf den Berufstitel zurück, damit `<img alt>` nie leer ist.
   */
  const altBySlug = useMemo(() => {
    const m = new Map<string, string>();
    const rows = new Map<string, CacheRow>(
      ((data ?? []) as CacheRow[]).map((r) => [r.slug, r]),
    );
    for (const it of items) {
      const row = rows.get(it.slug);
      m.set(
        it.slug,
        resolveBerufAltText({
          altText: row?.alt_text,
          title: it.title,
          kammer: it.kammer,
        }),
      );
    }
    return m;
  }, [data, items]);

  const statusBySlug = useMemo(() => {
    const m = new Map<string, 'ready' | 'generating' | 'queued' | 'failed'>();
    const known = new Map<string, CacheRow>(
      ((data ?? []) as CacheRow[]).map((r) => [r.slug, r]),
    );
    for (const s of slugs) {
      const row = known.get(s);
      if (row?.status === 'ready' && row.image_url) {
        m.set(s, 'ready');
      } else if (row?.status === 'generating' || row?.status === 'pending') {
        m.set(s, 'generating');
      } else if (row?.status === 'failed') {
        m.set(s, 'failed');
      } else if (triggered.has(s) || row) {
        m.set(s, 'queued');
      }
    }
    return m;
  }, [data, slugs, triggered]);

  /** Edge-Function-Fehlermeldung pro Slug (nur für `failed`-Status gefüllt). */
  const errorBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (data ?? []) as CacheRow[]) {
      if (r.status === 'failed' && r.error) m.set(r.slug, r.error);
    }
    return m;
  }, [data]);

  /**
   * Manuelles Re-Trigger der Generierung mit `force: true`. UI-Karten können
   * diese Funktion an einen Retry-Button binden — die Edge Function loggt das
   * Event als `retry_requested` und ersetzt das Cache-Bild deterministisch.
   */
  const retry = useMemo(() => async (slug: string) => {
    const item = items.find((i) => i.slug === slug);
    if (!item) return;
    try {
      await supabase.functions.invoke('generate-beruf-image', {
        body: {
          force: true,
          items: [{ slug: item.slug, title: item.title, kammer: item.kammer ?? null }],
        },
      });
    } catch (e) {
      console.warn('[useBerufImages] retry failed', e);
    } finally {
      qc.invalidateQueries({ queryKey: ['beruf-image-cache', slugsKey] });
    }
  }, [items, qc, slugsKey]);

  return { imageBySlug, statusBySlug, altBySlug, errorBySlug, retry };
}

