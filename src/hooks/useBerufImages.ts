import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type BerufImageItem = { slug: string; title: string; kammer?: string | null };

type CacheRow = { slug: string; status: string; image_url: string | null };

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
        .select('slug,status,image_url')
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

  return { imageBySlug };
}
