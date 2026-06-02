/**
 * SEO Preview Overlay — Dev/QA-Tool
 *
 * Live-Inspektion der aktuellen Route: Title, Meta-Description, Canonical,
 * OG-Tags, JSON-LD. Liest ausschließlich aus document.head (kein eigener
 * SEO-Code, kein SSOT-Bypass). Reine Presentation-Layer.
 *
 * Aktivierung:
 *   - DEV-Modus (import.meta.env.DEV): immer geladen, sichtbar via FAB
 *   - PROD: nur mit ?seoPreview=1 in der URL
 *   - Tastenkürzel Strg/Cmd+Shift+S toggelt sichtbar/unsichtbar
 *
 * Keine Tracking-/Network-Calls. Keine Auth-Abhängigkeit.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Eye, EyeOff, X, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface HeadSnapshot {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  ogType: string;
  twitterCard: string;
  jsonLd: unknown[];
  jsonLdRaw: string[];
}


export function snapshotHead(doc: Document = document): HeadSnapshot {
  const get = (sel: string, attr = 'content') =>
    doc.head.querySelector(sel)?.getAttribute(attr) ?? '';
  const jsonLdNodes = Array.from(
    doc.head.querySelectorAll('script[type="application/ld+json"]'),
  );
  const jsonLdRaw = jsonLdNodes.map((n) => n.textContent ?? '');
  const jsonLd: unknown[] = [];
  for (const raw of jsonLdRaw) {
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      jsonLd.push({ __parse_error: true, raw: raw.slice(0, 200) });
    }
  }
  return {
    title: doc.title ?? '',
    description: get('meta[name="description"]'),
    canonical: get('link[rel="canonical"]', 'href'),
    robots: get('meta[name="robots"]'),
    ogTitle: get('meta[property="og:title"]'),
    ogDescription: get('meta[property="og:description"]'),
    ogImage: get('meta[property="og:image"]'),
    ogUrl: get('meta[property="og:url"]'),
    ogType: get('meta[property="og:type"]'),
    twitterCard: get('meta[name="twitter:card"]'),
    jsonLd,
    jsonLdRaw,
  };
}


function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('seoPreview') === '1';
}

interface CheckRow {
  label: string;
  ok: boolean;
  value: string;
  hint?: string;
}

function evaluate(snap: HeadSnapshot): { rows: CheckRow[]; score: number } {
  const rows: CheckRow[] = [
    {
      label: 'Title',
      value: snap.title,
      ok: snap.title.length >= 15 && snap.title.length <= 70,
      hint: `${snap.title.length} Zeichen (Ziel 15–70)`,
    },
    {
      label: 'Meta Description',
      value: snap.description,
      ok: snap.description.length >= 50 && snap.description.length <= 170,
      hint: `${snap.description.length} Zeichen (Ziel 50–170)`,
    },
    {
      label: 'Canonical',
      value: snap.canonical,
      ok: !!snap.canonical && snap.canonical.startsWith('http'),
    },
    {
      label: 'OG Title',
      value: snap.ogTitle,
      ok: !!snap.ogTitle,
    },
    {
      label: 'OG Description',
      value: snap.ogDescription,
      ok: !!snap.ogDescription,
    },
    {
      label: 'OG Image',
      value: snap.ogImage,
      ok: !!snap.ogImage,
      hint: snap.ogImage ? '' : 'optional, aber für Social-Previews empfohlen',
    },
    {
      label: 'OG URL',
      value: snap.ogUrl,
      ok: !!snap.ogUrl,
    },
    {
      label: 'JSON-LD',
      value: `${snap.jsonLd.length} Block${snap.jsonLd.length === 1 ? '' : 'e'}`,
      ok: snap.jsonLd.length >= 1,
    },
  ];
  const score = Math.round((rows.filter((r) => r.ok).length / rows.length) * 100);
  return { rows, score };
}

export function SeoPreviewOverlay() {
  const enabled = useMemo(isEnabled, []);
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<HeadSnapshot | null>(null);
  const { pathname, search } = useLocation();

  const refresh = useCallback(() => {
    // Helmet schreibt async — kurzer Tick, damit Werte stabil sind.
    setTimeout(() => setSnap(snapshotHead()), 50);
  }, []);

  useEffect(() => {
    if (!enabled || !open) return;
    refresh();
  }, [enabled, open, pathname, search, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  if (!enabled) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="SEO-Vorschau (Strg+Shift+S)"
        aria-label="SEO-Vorschau öffnen"
        className="fixed bottom-4 left-4 z-[9999] h-10 w-10 rounded-full bg-foreground text-background shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
      >
        <Eye className="h-4 w-4" />
      </button>
    );
  }

  const evaluated = snap ? evaluate(snap) : null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background/95 backdrop-blur shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 text-foreground" />
          <span className="text-sm font-semibold">SEO Preview</span>
          {evaluated && (
            <Badge
              variant={evaluated.score >= 85 ? 'default' : evaluated.score >= 60 ? 'secondary' : 'destructive'}
              className="text-xs"
            >
              {evaluated.score}%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={refresh} title="Neu laden">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)} title="Schließen">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border truncate">
        Route: <span className="font-mono text-foreground">{pathname}{search}</span>
      </div>
      <ScrollArea className="max-h-[60vh]">
        <div className="p-3 space-y-3">
          {!snap && <div className="text-sm text-muted-foreground">Lade Head-Snapshot…</div>}
          {snap && evaluated && (
            <>
              <ul className="space-y-2">
                {evaluated.rows.map((r) => (
                  <li key={r.label} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      {r.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="font-medium">{r.label}</span>
                      {r.hint && <span className="text-muted-foreground">· {r.hint}</span>}
                    </div>
                    {r.value && (
                      <div className="mt-0.5 ml-5 font-mono text-[11px] text-muted-foreground break-all line-clamp-3">
                        {r.value}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <details className="text-xs">
                <summary className="cursor-pointer font-medium">
                  Robots: <span className="font-mono text-muted-foreground">{snap.robots || '—'}</span>
                </summary>
              </details>

              <details className="text-xs" open>
                <summary className="cursor-pointer font-medium">
                  JSON-LD ({snap.jsonLd.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {snap.jsonLd.map((obj, i) => {
                    const types = extractTypes(obj);
                    return (
                      <div key={i} className="rounded-md border border-border bg-muted/30 p-2">
                        <div className="flex flex-wrap gap-1 mb-1">
                          {types.map((t) => (
                            <Badge key={t} variant="outline" className="text-[10px]">
                              {t}
                            </Badge>
                          ))}
                          {types.length === 0 && (
                            <Badge variant="destructive" className="text-[10px]">
                              ohne @type
                            </Badge>
                          )}
                        </div>
                        <pre className="font-mono text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                          {JSON.stringify(obj, null, 2)}
                        </pre>
                      </div>
                    );
                  })}
                  {snap.jsonLd.length === 0 && (
                    <div className="text-muted-foreground">Keine JSON-LD-Blöcke gefunden.</div>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </ScrollArea>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Strg/Cmd + Shift + S · {import.meta.env.DEV ? 'DEV' : 'PROD ?seoPreview=1'}
      </div>
    </div>
  );
}

function extractTypes(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  const t = o['@type'];
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return [t];
  if (Array.isArray(o['@graph'])) {
    return (o['@graph'] as unknown[]).flatMap(extractTypes);
  }
  return [];
}
