import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, XCircle, AlertTriangle, Send, Globe, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import runbookMd from '../../../../docs/runbooks/cutover-rollback.md?raw';

interface RouteCheck {
  route: string;
  url: string;
  status: number;
  ok: boolean;
  title: string | null;
  canonical: string | null;
  jsonLdCount: number;
  hasJsonLd: boolean;
  metaDescription: string | null;
  reasons: string[];
}
interface SmokeResult {
  verdict: 'GO' | 'BLOCKED';
  host: string;
  total: number;
  passed: number;
  failed: number;
  checks: RouteCheck[];
}

const DEFAULT_ROUTES = [
  '/',
  '/berufe',
  '/berufe/industriekaufmann-frau',
  '/pruefungstraining-azubis',
  '/blog',
  '/aevo-pruefung',
  '/fiae-pruefung',
].join('\n');

async function callCutover(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('admin-cutover-control', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  return data;
}

export default function CutoverPanel() {
  const qc = useQueryClient();
  const [host, setHost] = useState('https://examfit.de');
  const [routesText, setRoutesText] = useState(DEFAULT_ROUTES);
  const [siteUrl, setSiteUrl] = useState('https://examfit.de/');
  const [feedpath, setFeedpath] = useState('https://examfit.de/sitemap.xml');
  const [smoke, setSmoke] = useState<SmokeResult | null>(null);

  // Audit-Historie der letzten Cutover-Aktionen
  const auditQ = useQuery({
    queryKey: ['cutover-audit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auto_heal_log')
        .select('id, created_at, action_type, result_status, details')
        .like('action_type', 'cutover_%')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const smokeMut = useMutation({
    mutationFn: async () => {
      const routes = routesText.split('\n').map((s) => s.trim()).filter(Boolean);
      return (await callCutover('run_post_cutover_smoke', { host, routes })) as SmokeResult;
    },
    onSuccess: (data) => {
      setSmoke(data);
      qc.invalidateQueries({ queryKey: ['cutover-audit'] });
      toast[data.verdict === 'GO' ? 'success' : 'error'](
        `Smoke ${data.verdict} — ${data.passed}/${data.total} Routen ok`,
      );
    },
    onError: (e: Error) => toast.error(`Smoke fehlgeschlagen: ${e.message}`),
  });

  const submitMut = useMutation({
    mutationFn: async () => callCutover('gsc_submit_sitemap', { siteUrl, feedpath }),
    onSuccess: (data: { ok: boolean; http_status: number; response: unknown }) => {
      qc.invalidateQueries({ queryKey: ['cutover-audit'] });
      qc.invalidateQueries({ queryKey: ['cutover-gsc-status'] });
      if (data.ok) toast.success(`GSC: Sitemap submitted (HTTP ${data.http_status})`);
      else toast.error(`GSC: HTTP ${data.http_status} — ${JSON.stringify(data.response).slice(0, 200)}`);
    },
    onError: (e: Error) => toast.error(`GSC submit fehlgeschlagen: ${e.message}`),
  });

  const statusQ = useQuery({
    queryKey: ['cutover-gsc-status', siteUrl, feedpath],
    queryFn: async () =>
      (await callCutover('gsc_get_sitemap_status', { siteUrl, feedpath })) as {
        ok: boolean; http_status: number; response: any;
      },
    enabled: false,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" /> Cutover-Steuerung
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Operativer Schaltraum für DNS-Cutover, GSC-Sitemap-Submit und Post-Cutover-Smoke.
          Alle Aktionen schreiben Audit nach <code>auto_heal_log</code>.
        </p>
      </div>

      <Tabs defaultValue="smoke" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="smoke" className="flex-1">Post-Cutover Smoke</TabsTrigger>
          <TabsTrigger value="gsc" className="flex-1">GSC Sitemap</TabsTrigger>
          <TabsTrigger value="audit" className="flex-1">Audit-Historie</TabsTrigger>
          <TabsTrigger value="runbook" className="flex-1">Runbook</TabsTrigger>
        </TabsList>

        {/* ── Smoke ─────────────────────────────────────────── */}
        <TabsContent value="smoke" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Route-HTML verifizieren</CardTitle>
              <CardDescription>
                Holt jede Route live ab und prüft <code>title</code>, <code>canonical</code>{' '}
                und JSON-LD. Verdict <strong>GO</strong> = alle grün.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-[1fr_auto] gap-3">
                <div>
                  <Label htmlFor="host" className="text-xs">Host</Label>
                  <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => smokeMut.mutate()}
                    disabled={smokeMut.isPending}
                    className="gap-2"
                  >
                    {smokeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Smoke ausführen
                  </Button>
                </div>
              </div>
              <div>
                <Label htmlFor="routes" className="text-xs">Routen (eine pro Zeile)</Label>
                <Textarea
                  id="routes"
                  value={routesText}
                  onChange={(e) => setRoutesText(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>

          {smoke && (
            <Card className={cn(
              smoke.verdict === 'GO'
                ? 'border-success/40 bg-success-bg-subtle'
                : 'border-destructive/40 bg-destructive-bg-subtle',
            )}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {smoke.verdict === 'GO'
                      ? <CheckCircle2 className="h-5 w-5 text-success" />
                      : <XCircle className="h-5 w-5 text-destructive" />}
                    Verdict: {smoke.verdict}
                  </CardTitle>
                  <Badge variant={smoke.verdict === 'GO' ? 'default' : 'destructive'}>
                    {smoke.passed}/{smoke.total} ok
                  </Badge>
                </div>
                <CardDescription>{smoke.host}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {smoke.checks.map((c) => (
                    <div
                      key={c.route}
                      className={cn(
                        'rounded-md border p-3 text-sm',
                        c.ok ? 'border-success/30 bg-card' : 'border-destructive/30 bg-card',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {c.ok
                            ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                            : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                          <span className="font-mono truncate">{c.route}</span>
                          <Badge variant="outline" className="text-xs">{c.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          jsonLd={c.jsonLdCount}
                        </div>
                      </div>
                      {!c.ok && (
                        <div className="mt-2 space-y-1 text-xs">
                          <div className="flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            {c.reasons.join(', ')}
                          </div>
                          <div className="text-muted-foreground">
                            title: <span className="font-mono">{c.title?.slice(0, 80) ?? '—'}</span>
                          </div>
                          <div className="text-muted-foreground">
                            canonical: <span className="font-mono">{c.canonical ?? '—'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── GSC ───────────────────────────────────────────── */}
        <TabsContent value="gsc" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" /> Google Search Console — Sitemap einreichen
              </CardTitle>
              <CardDescription>
                Sendet einen <code>PUT /sites/&lt;site&gt;/sitemaps/&lt;feedpath&gt;</code> an die
                GSC-API über den Connector-Gateway. Erfordert verifizierte Property in GSC.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="siteUrl" className="text-xs">Site URL (mit /)</Label>
                <Input id="siteUrl" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="feedpath" className="text-xs">Sitemap URL</Label>
                <Input id="feedpath" value={feedpath} onChange={(e) => setFeedpath(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending} className="gap-2">
                  {submitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Sitemap an GSC senden
                </Button>
                <Button variant="outline" onClick={() => statusQ.refetch()} disabled={statusQ.isFetching}>
                  {statusQ.isFetching ? 'Lade…' : 'Status abrufen'}
                </Button>
              </div>

              {statusQ.data && (
                <div className="rounded-md border border-border bg-card p-3 text-xs">
                  <div className="flex items-center gap-2 mb-2">
                    {statusQ.data.ok
                      ? <CheckCircle2 className="h-4 w-4 text-success" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                    <span className="font-medium">HTTP {statusQ.data.http_status}</span>
                  </div>
                  <ScrollArea className="h-48">
                    <pre className="text-xs">{JSON.stringify(statusQ.data.response, null, 2)}</pre>
                  </ScrollArea>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit ─────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit-Historie</CardTitle>
              <CardDescription>
                Letzte 20 Cutover-Aktionen aus <code>auto_heal_log</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditQ.isLoading ? (
                <div className="text-sm text-muted-foreground">Lade…</div>
              ) : !auditQ.data?.length ? (
                <div className="text-sm text-muted-foreground">Noch keine Aktionen.</div>
              ) : (
                <div className="space-y-2">
                  {auditQ.data.map((row) => (
                    <div key={row.id} className="rounded-md border border-border bg-card p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {row.result_status === 'success'
                            ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                            : row.result_status === 'failure'
                              ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
                              : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                          <span className="font-mono truncate">{row.action_type}</span>
                        </div>
                        <span className="text-muted-foreground shrink-0">
                          {new Date(row.created_at).toLocaleString('de-DE')}
                        </span>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-muted-foreground">Details</summary>
                        <pre className="mt-2 overflow-auto text-xs">
                          {JSON.stringify(row.details, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Runbook ───────────────────────────────────────── */}
        <TabsContent value="runbook" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Cutover & Rollback Runbook
              </CardTitle>
              <CardDescription>
                SSOT-Dokument <code>docs/runbooks/cutover-rollback.md</code>. Inline gerendert.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[60vh] pr-4">
                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{runbookMd}</ReactMarkdown>
                </article>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
