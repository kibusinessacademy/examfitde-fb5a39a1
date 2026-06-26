import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

type Diag = {
  beruf_id: string;
  title: string;
  curriculum_id: string | null;
  package_id: string | null;
  is_sellable: boolean;
  missing_curriculum: boolean;
  has_published_course: boolean;
  has_active_product: boolean;
  has_stripe_price: boolean;
  gap_classification: string | null;
  gap_recommended_action: string | null;
  lesson_count: number | null;
  lesson_ready_count: number | null;
  teaser_is_real_usp: boolean;
  block_reason: string;
  ausbildungsdauer_monate: number | null;
  dqr_niveau: number | null;
};

type Studium = {
  product_id: string;
  product_title: string;
  product_slug: string | null;
  curriculum_id: string;
  track: string;
  is_sellable: boolean;
  visible_in_catalog: boolean;
  finding: string;
};

type TeaserQ = {
  category: string;
  entries: number;
  with_real_usp: number;
  with_fallback_only: number;
  pct_real_usp: number | null;
};

const reasonLabel: Record<string, string> = {
  sellable: 'Verfügbar',
  no_curriculum: 'Kein Curriculum verknüpft',
  course_not_published: 'Course-Row noch nicht published',
  product_inactive_or_private: 'Produkt nicht aktiv/öffentlich',
  missing_stripe_price: 'Kein aktiver Stripe-Preis',
  lessons_gap_unknown: 'Lessons-Gap-Status unbekannt',
  lessons_not_ready: 'Lessons nicht READY (Content-Lücke)',
  unknown: 'Unbekannt',
};

export default function CatalogDiagnosticsPage() {
  const [q, setQ] = useState('');
  const [reason, setReason] = useState<string>('all');

  const diag = useQuery({
    queryKey: ['admin-catalog-diagnostics'],
    queryFn: async (): Promise<Diag[]> => {
      const { data, error } = await (supabase as any).rpc('admin_catalog_diagnostics');
      if (error) throw error;
      return (data ?? []) as Diag[];
    },
    staleTime: 60_000,
  });

  const studium = useQuery({
    queryKey: ['admin-studium-gap'],
    queryFn: async (): Promise<Studium[]> => {
      const { data, error } = await (supabase as any).rpc('admin_studium_gap');
      if (error) throw error;
      return (data ?? []) as Studium[];
    },
    staleTime: 60_000,
  });

  const teaserQ = useQuery({
    queryKey: ['admin-catalog-teaser-quality'],
    queryFn: async (): Promise<TeaserQ[]> => {
      const { data, error } = await (supabase as any).rpc('admin_catalog_teaser_quality');
      if (error) throw error;
      return (data ?? []) as TeaserQ[];
    },
    staleTime: 60_000,
  });

  const rows = diag.data ?? [];

  const summary = useMemo(() => {
    const total = rows.length;
    const sellable = rows.filter((r) => r.is_sellable).length;
    const fallbackTeaser = rows.filter((r) => !r.teaser_is_real_usp).length;
    const blockedByReason = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.block_reason] = (acc[r.block_reason] ?? 0) + 1;
      return acc;
    }, {});
    return { total, sellable, fallbackTeaser, blockedByReason };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (reason !== 'all' && r.block_reason !== reason) return false;
      if (!needle) return true;
      return r.title.toLowerCase().includes(needle);
    });
  }, [rows, q, reason]);

  const studiumFindings = (studium.data ?? []).filter((s) => s.finding !== 'ok');

  return (
    <div className="container py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold mb-1">Catalog Diagnostics</h1>
        <p className="text-muted-foreground">
          Warum springt eine Beruf-Karte auf „Verfügbar" oder bleibt „In Vorbereitung"? Welche Teaser sind Fallback statt USP? STUDIUM-Drift.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Berufe gesamt</CardDescription>
            <CardTitle className="text-3xl">{summary.total}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Sellable (Verfügbar)</CardDescription>
            <CardTitle className="text-3xl text-primary">{summary.sellable}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Teaser ohne echtes USP</CardDescription>
            <CardTitle className="text-3xl">{summary.fallbackTeaser}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>STUDIUM Drift-Findings</CardDescription>
            <CardTitle className={`text-3xl ${studiumFindings.length ? 'text-destructive' : 'text-primary'}`}>
              {studiumFindings.length}
            </CardTitle></CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="berufe">
        <TabsList>
          <TabsTrigger value="berufe">Berufe ({summary.total})</TabsTrigger>
          <TabsTrigger value="teaser">Teaser-Qualität</TabsTrigger>
          <TabsTrigger value="studium">STUDIUM Drift {studiumFindings.length > 0 && (
            <Badge variant="destructive" className="ml-2">{studiumFindings.length}</Badge>
          )}</TabsTrigger>
          <TabsTrigger value="stuck">In Vorbereitung – Blocker</TabsTrigger>
        </TabsList>

        <TabsContent value="berufe" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Beruf suchen…"
              className="max-w-sm"
            />
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-background border border-input rounded-md px-3 text-sm"
            >
              <option value="all">Alle Status</option>
              {Object.keys(reasonLabel).map((k) => (
                <option key={k} value={k}>{reasonLabel[k]}</option>
              ))}
            </select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Beruf</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Curriculum</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Stripe</TableHead>
                    <TableHead>Lessons</TableHead>
                    <TableHead>Teaser</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 500).map((r) => (
                    <TableRow key={r.beruf_id}>
                      <TableCell className="font-medium">{r.title}</TableCell>
                      <TableCell>
                        {r.is_sellable ? (
                          <Badge className="bg-primary">Verfügbar</Badge>
                        ) : (
                          <Badge variant="outline" title={reasonLabel[r.block_reason]}>
                            {reasonLabel[r.block_reason] ?? r.block_reason}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{r.missing_curriculum ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}</TableCell>
                      <TableCell>{r.has_published_course ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell>
                      <TableCell>{r.has_active_product ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell>
                      <TableCell>{r.has_stripe_price ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell>
                      <TableCell className="text-xs">
                        {r.lesson_ready_count ?? 0}/{r.lesson_count ?? 0}
                        {r.gap_classification && <div className="text-muted-foreground">{r.gap_classification}</div>}
                      </TableCell>
                      <TableCell>
                        {r.teaser_is_real_usp ? (
                          <Badge variant="secondary">USP</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-600">Fallback</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 500 && (
                <p className="text-xs text-muted-foreground p-3">Erste 500 von {filtered.length} angezeigt — filtere weiter.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teaser">
          <Card>
            <CardHeader>
              <CardTitle>Teaser-Hygiene pro Kategorie</CardTitle>
              <CardDescription>Wieviele Karten haben ein echtes USP (taetigkeitsprofil) gegenüber dem generischen Fallback?</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kategorie</TableHead>
                    <TableHead>Gesamt</TableHead>
                    <TableHead>Mit USP</TableHead>
                    <TableHead>Nur Fallback</TableHead>
                    <TableHead>% USP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(teaserQ.data ?? []).map((t) => (
                    <TableRow key={t.category}>
                      <TableCell className="font-medium">{t.category}</TableCell>
                      <TableCell>{t.entries}</TableCell>
                      <TableCell>{t.with_real_usp}</TableCell>
                      <TableCell>{t.with_fallback_only}</TableCell>
                      <TableCell>
                        <Badge variant={t.pct_real_usp && t.pct_real_usp > 50 ? 'secondary' : 'outline'}>
                          {t.pct_real_usp ?? 0}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                Fallback-Karten rendern keinen profilspezifischen USP — Inhalt sollte über <code>berufe.taetigkeitsprofil</code> gefüllt werden.
                DQR-Niveau und Ausbildungsdauer werden in der Karte nicht mehr gerendert (Reality: ersetzt durch Teaser).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="studium">
          <Card>
            <CardHeader>
              <CardTitle>STUDIUM Gap-Detector</CardTitle>
              <CardDescription>Sellable STUDIUM-Produkte ohne sichtbare Karte im <code>/berufe</code>-Katalog.</CardDescription>
            </CardHeader>
            <CardContent>
              {studiumFindings.length === 0 ? (
                <div className="flex items-center gap-2 text-primary py-6 justify-center">
                  <CheckCircle2 className="h-5 w-5" />
                  Keine STUDIUM-Drift-Findings. Aktuell <strong>{(studium.data ?? []).length}</strong> STUDIUM-Produkte beobachtet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produkt</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Sellable</TableHead>
                      <TableHead>In Katalog</TableHead>
                      <TableHead>Finding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {studiumFindings.map((s) => (
                      <TableRow key={s.product_id}>
                        <TableCell className="font-medium">{s.product_title}</TableCell>
                        <TableCell className="text-xs">{s.product_slug ?? '—'}</TableCell>
                        <TableCell>{s.is_sellable ? '✓' : '—'}</TableCell>
                        <TableCell>{s.visible_in_catalog ? '✓' : '✗'}</TableCell>
                        <TableCell><Badge variant="destructive">{s.finding}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stuck">
          <Card>
            <CardHeader>
              <CardTitle>Warum 168 Karten „In Vorbereitung" bleiben</CardTitle>
              <CardDescription>Aggregierte Blocker-Ursachen über alle nicht-sellable Berufe.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(summary.blockedByReason)
                .filter(([k]) => k !== 'sellable')
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <div key={k} className="flex items-center justify-between border-b py-2">
                    <span>{reasonLabel[k] ?? k}</span>
                    <Badge variant="outline">{n}</Badge>
                  </div>
                ))}
              <p className="text-xs text-muted-foreground mt-3">
                Lesefehlt-Quelle: <code>v_admin_catalog_diagnostics</code> · Wave-Plan: Pakete mit
                <code> lessons_not_ready</code> brauchen Content-Generation, nicht nur Re-Publish.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
