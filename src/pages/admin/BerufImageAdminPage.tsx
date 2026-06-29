import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Save, AlertTriangle, ImageOff } from 'lucide-react';
import { toast } from 'sonner';

type Row = {
  slug: string;
  title: string | null;
  kammer: string | null;
  status: string;
  image_url: string | null;
  alt_text: string | null;
  scene_id: string | null;
  prompt_text: string | null;
  model: string | null;
  prompt_version: number | null;
  error: string | null;
  meta: Record<string, unknown> | null;
  scene_subject: string | null;
  scene_setting: string | null;
  scene_action: string | null;
  generated_at: string | null;
  updated_at: string | null;
};

type EventRow = {
  id: number;
  slug: string;
  event: string;
  scene_id: string | null;
  prompt_version: number | null;
  model: string | null;
  duration_ms: number | null;
  error: string | null;
  force_requested: boolean;
  created_at: string;
};

/**
 * Admin-Cockpit für die Berufsbild-Generierung.
 *
 * - Listet alle Cache-Einträge mit `scene_id`, `prompt_version`, `model`,
 *   `prompt_text` und gespeichertem `meta` JSON.
 * - Erlaubt admin-only Overrides (RLS-geschützt) für `scene_id`,
 *   `prompt_text`, `model`, `alt_text` und `meta`.
 * - Zeigt das forensische Event-Log pro Slug an (queued → generating →
 *   ready/failed) und bietet einen Retry-Button (`force: true`).
 */
export default function BerufImageAdminPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'pending' | 'generating' | 'failed'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Row>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: cache, error }, { data: ev }] = await Promise.all([
      supabase
        .from('beruf_image_cache')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500),
      supabase
        .from('beruf_image_generation_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);
    if (error) toast.error(`Laden fehlgeschlagen: ${error.message}`);
    setRows((cache ?? []) as Row[]);
    setEvents((ev ?? []) as EventRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.slug.toLowerCase().includes(q) ||
        (r.title ?? '').toLowerCase().includes(q) ||
        (r.scene_id ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, statusFilter]);

  const eventsBySlug = useMemo(() => {
    const m = new Map<string, EventRow[]>();
    for (const e of events) {
      const arr = m.get(e.slug) ?? [];
      arr.push(e);
      m.set(e.slug, arr);
    }
    return m;
  }, [events]);

  const selectedRow = rows.find((r) => r.slug === selected) ?? null;

  function openEdit(row: Row) {
    setSelected(row.slug);
    setDraft({
      scene_id: row.scene_id,
      prompt_text: row.prompt_text,
      model: row.model,
      prompt_version: row.prompt_version,
      alt_text: row.alt_text,
      meta: row.meta,
    });
  }

  async function save() {
    if (!selectedRow) return;
    setSaving(true);
    let metaParsed: Record<string, unknown> | null = null;
    try {
      metaParsed = typeof draft.meta === 'string'
        ? JSON.parse(draft.meta as unknown as string)
        : (draft.meta as Record<string, unknown> | null);
    } catch {
      toast.error('meta JSON ist nicht parsebar.');
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from('beruf_image_cache')
      .update({
        scene_id: draft.scene_id ?? null,
        prompt_text: draft.prompt_text ?? null,
        model: draft.model ?? null,
        prompt_version: draft.prompt_version ?? null,
        alt_text: draft.alt_text ?? null,
        meta: metaParsed ?? {},
      })
      .eq('slug', selectedRow.slug);
    setSaving(false);
    if (error) { toast.error(`Speichern fehlgeschlagen: ${error.message}`); return; }
    toast.success('Metadaten gespeichert');
    await load();
  }

  async function retry(slug: string) {
    const row = rows.find((r) => r.slug === slug);
    if (!row) return;
    const { error } = await supabase.functions.invoke('generate-beruf-image', {
      body: { force: true, items: [{ slug: row.slug, title: row.title ?? row.slug, kammer: row.kammer }] },
    });
    if (error) toast.error(`Retry fehlgeschlagen: ${error.message}`);
    else toast.success(`Retry für ${slug} gestartet`);
    setTimeout(load, 1500);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold">Berufsbild-Generierung · Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scene-IDs, Prompts, Modelle und Meta pro Slug · Forensisches Event-Log · Manuelles Retry.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Aktualisieren
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Suche slug / title / scene_id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        {(['all', 'ready', 'generating', 'pending', 'failed'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </Button>
        ))}
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} / {rows.length} Slugs
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Slugs</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[70vh] overflow-auto divide-y divide-border">
            {filtered.map((r) => {
              const altMissing = !r.alt_text;
              return (
                <button
                  key={r.slug}
                  onClick={() => openEdit(r)}
                  className={`block w-full text-left px-4 py-3 hover:bg-muted/40 ${selected === r.slug ? 'bg-muted/60' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs truncate">{r.slug}</div>
                    <Badge
                      variant={r.status === 'ready' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'}
                      className="text-[10px]"
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span className="truncate">{r.title ?? '—'}</span>
                    {r.scene_id && <span className="opacity-70">· {r.scene_id}</span>}
                    {r.prompt_version != null && <span className="opacity-70">· v{r.prompt_version}</span>}
                    {altMissing && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <ImageOff className="h-3 w-3" /> alt fehlt
                      </span>
                    )}
                    {r.status === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3 w-3" /> {(r.error ?? '').slice(0, 40)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {!filtered.length && <div className="px-4 py-8 text-sm text-muted-foreground text-center">Keine Treffer.</div>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedRow ? (
            <>
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    <span className="font-mono text-sm">{selectedRow.slug}</span>
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => retry(selectedRow.slug)}>
                      <RefreshCw className="h-4 w-4 mr-1" /> Force-Retry
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      Speichern
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedRow.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedRow.image_url}
                      alt={selectedRow.alt_text ?? selectedRow.title ?? selectedRow.slug}
                      className="w-full max-h-64 object-cover rounded-md border"
                    />
                  )}
                  <Grid label="scene_id">
                    <Input
                      value={(draft.scene_id as string | null) ?? ''}
                      onChange={(e) => setDraft({ ...draft, scene_id: e.target.value })}
                    />
                  </Grid>
                  <Grid label="model">
                    <Input
                      value={(draft.model as string | null) ?? ''}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    />
                  </Grid>
                  <Grid label="prompt_version">
                    <Input
                      type="number"
                      value={(draft.prompt_version as number | null) ?? ''}
                      onChange={(e) => setDraft({ ...draft, prompt_version: e.target.value ? Number(e.target.value) : null })}
                    />
                  </Grid>
                  <Grid label="alt_text">
                    <Textarea
                      rows={2}
                      value={(draft.alt_text as string | null) ?? ''}
                      onChange={(e) => setDraft({ ...draft, alt_text: e.target.value })}
                    />
                  </Grid>
                  <Grid label="prompt_text">
                    <Textarea
                      rows={5}
                      value={(draft.prompt_text as string | null) ?? ''}
                      onChange={(e) => setDraft({ ...draft, prompt_text: e.target.value })}
                    />
                  </Grid>
                  <Grid label="meta (JSON)">
                    <Textarea
                      rows={6}
                      className="font-mono text-xs"
                      value={typeof draft.meta === 'string'
                        ? (draft.meta as unknown as string)
                        : JSON.stringify(draft.meta ?? {}, null, 2)}
                      onChange={(e) => setDraft({ ...draft, meta: e.target.value as unknown as Record<string, unknown> })}
                    />
                  </Grid>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>scene_subject: <span className="font-mono">{selectedRow.scene_subject ?? '—'}</span></div>
                    <div>scene_setting: <span className="font-mono">{selectedRow.scene_setting ?? '—'}</span></div>
                    <div>scene_action: <span className="font-mono">{selectedRow.scene_action ?? '—'}</span></div>
                    <div>updated_at: {selectedRow.updated_at ?? '—'} · generated_at: {selectedRow.generated_at ?? '—'}</div>
                    {selectedRow.error && (
                      <div className="text-destructive">last error: {selectedRow.error}</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Event-Log</CardTitle></CardHeader>
                <CardContent className="p-0 max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">Zeit</th>
                        <th className="text-left px-3 py-1.5">Event</th>
                        <th className="text-left px-3 py-1.5">Scene</th>
                        <th className="text-left px-3 py-1.5">v</th>
                        <th className="text-right px-3 py-1.5">ms</th>
                        <th className="text-left px-3 py-1.5">Fehler</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(eventsBySlug.get(selectedRow.slug) ?? []).map((e) => (
                        <tr key={e.id}>
                          <td className="px-3 py-1.5 font-mono">{new Date(e.created_at).toLocaleString('de-DE')}</td>
                          <td className="px-3 py-1.5">
                            <Badge
                              variant={e.event === 'ready' ? 'default' : e.event === 'failed' ? 'destructive' : 'secondary'}
                              className="text-[10px]"
                            >{e.event}</Badge>
                            {e.force_requested && <span className="ml-1 text-[10px] text-amber-600">force</span>}
                          </td>
                          <td className="px-3 py-1.5">{e.scene_id ?? '—'}</td>
                          <td className="px-3 py-1.5">{e.prompt_version ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right">{e.duration_ms ?? ''}</td>
                          <td className="px-3 py-1.5 text-destructive truncate max-w-[200px]">{e.error ?? ''}</td>
                        </tr>
                      ))}
                      {!(eventsBySlug.get(selectedRow.slug) ?? []).length && (
                        <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Keine Events.</td></tr>
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Wähle links einen Slug zur Inspektion / Bearbeitung.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Grid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 items-start">
      <label className="text-xs font-medium text-muted-foreground pt-2">{label}</label>
      <div>{children}</div>
    </div>
  );
}
