import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2, Clock, Package, XCircle, Activity,
  DollarSign, RefreshCw, Loader2, FileText, Headphones,
  Users, AlertTriangle, TrendingUp, ArrowRight, Play, RotateCcw, Pause
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const REFRESH_INTERVAL = 30_000;
const TOTAL_STEPS = 9;

interface PackageInfo {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  priority: number;
  current_step: string | null;
  step_status_json: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  track: string | null;
}

interface PlatformKPIs {
  seoPages: number;
  ticketsOpen: number;
  ticketsTotal: number;
  usersTotal: number;
  ordersPaid: number;
  revenueCents: number;
}

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Lernkurs',
  auto_seed_exam_blueprints: 'Blueprints',
  generate_exam_pool: 'Fragenpool',
  generate_oral_exam: 'Mündliche',
  build_ai_tutor_index: 'KI-Tutor',
  generate_handbook: 'Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA Council',
  auto_publish: 'Publish',
};

const STEP_ORDER = [
  'scaffold_learning_course', 'auto_seed_exam_blueprints', 'generate_exam_pool',
  'generate_oral_exam', 'build_ai_tutor_index', 'generate_handbook',
  'run_integrity_check', 'quality_council', 'auto_publish',
];

const fmtEur = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

export default function CommandPage() {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [kpis, setKpis] = useState<PlatformKPIs>({ seoPages: 0, ticketsOpen: 0, ticketsTotal: 0, usersTotal: 0, ordersPaid: 0, revenueCents: 0 });
  const [dailyCost, setDailyCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const sb = supabase as any;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const [pkgRes, ticketRes, profileRes, seoRes, orderRes, costRes] = await Promise.all([
        sb.from('course_packages')
          .select('id, title, status, build_progress, priority, current_step, step_status_json, created_at, updated_at, track')
          .lte('priority', 20)
          .order('priority')
          .order('created_at'),
        sb.from('support_tickets').select('status'),
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        sb.from('certification_seo_pages').select('id', { count: 'exact', head: true }),
        sb.from('orders').select('status, total_cents'),
        sb.from('ai_usage_log').select('cost_eur').gte('created_at', todayStart.toISOString()),
      ]);

      setPackages((pkgRes.data || []) as PackageInfo[]);

      const tickets = (ticketRes.data || []) as { status: string }[];
      const orders = (orderRes.data || []) as { status: string; total_cents: number }[];
      const paidOrders = orders.filter(o => o.status === 'paid');

      setKpis({
        seoPages: seoRes.count || 0,
        ticketsOpen: tickets.filter(t => t.status === 'open').length,
        ticketsTotal: tickets.length,
        usersTotal: profileRes.count || 0,
        ordersPaid: paidOrders.length,
        revenueCents: paidOrders.reduce((s, o) => s + (o.total_cents || 0), 0),
      });

      const costs = (costRes.data || []) as { cost_eur: number }[];
      setDailyCost(costs.reduce((s, c) => s + (c.cost_eur || 0), 0));

      setLastRefresh(new Date());
    } catch (e) { console.error('[Command] Load error:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('command-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // Analysis
  const analysis = useMemo(() => {
    if (!packages.length) return null;

    const total = packages.length;
    const published = packages.filter(p => p.status === 'published').length;
    const building = packages.filter(p => p.status === 'building').length;
    const queued = packages.filter(p => p.status === 'queued').length;
    const blocked = packages.filter(p => p.status === 'blocked').length;
    const failed = packages.filter(p => p.status === 'failed').length;
    const remaining = total - published;

    // Zero-based estimation: assume ~4h per package with 5 slots
    const hoursPerPackage = 4;
    const slotsAvailable = 5;
    const estimatedDays = Math.ceil((remaining * hoursPerPackage) / (slotsAvailable * 24));
    const estimatedDate = new Date(Date.now() + estimatedDays * 86400_000);

    return { total, published, building, queued, blocked, failed, remaining, estimatedDays, estimatedDate };
  }, [packages]);

  const triggerRunner = async () => {
    setActing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      toast.success('Pipeline-Runner getriggert');
      setTimeout(load, 2000);
    } catch (e: any) { toast.error(e.message); }
    setActing(false);
  };

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-96" />
    </div>
  );

  // Group by priority
  const prio5 = packages.filter(p => p.priority === 5);
  const prio10 = packages.filter(p => p.priority === 10);
  const prio15 = packages.filter(p => p.priority === 15);
  const prio20 = packages.filter(p => p.priority === 20);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Leitstelle</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Auto-Refresh {REFRESH_INTERVAL / 1000}s · {lastRefresh.toLocaleTimeString('de-DE')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={triggerRunner} disabled={acting}>
            <Play className="h-3.5 w-3.5 mr-1" /> Pipeline starten
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ═══ PRODUKT-KPIs ═══ */}
      {analysis && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KPICard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Fertig" value={`${analysis.published}/${analysis.total}`} accent="border-emerald-500/20" />
          <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="In Produktion" value={analysis.building} accent="border-primary/20" />
          <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Warteschlange" value={analysis.queued} />
          <KPICard icon={<Pause className="h-4 w-4 text-amber-500" />} label="Blockiert" value={analysis.blocked} alert={analysis.blocked > 0} />
          <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Fehlgeschlagen" value={analysis.failed} alert={analysis.failed > 0} />
          <KPICard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Prognose" value={`~${analysis.estimatedDays}d`} sublabel={analysis.estimatedDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} />
        </div>
      )}

      {/* ═══ FORTSCHRITTS-BALKEN ═══ */}
      {analysis && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Gesamtfortschritt</span>
              <span className="text-sm text-muted-foreground">{analysis.published} von {analysis.total} Produkten live</span>
            </div>
            <Progress value={(analysis.published / analysis.total) * 100} className="h-3" />
          </CardContent>
        </Card>
      )}

      {/* ═══ PRODUKT-TABELLEN ═══ */}
      {prio10.length > 0 && (
        <ProductGroup title="Top 10 Ausbildungsberufe" emoji="🥇" packages={prio10} />
      )}
      {prio15.length > 0 && (
        <ProductGroup title="AEVO" emoji="🎓" packages={prio15} />
      )}
      {prio20.length > 0 && (
        <ProductGroup title="Nächste 10 Ausbildungsberufe" emoji="🥈" packages={prio20} />
      )}
      {prio5.length > 0 && (
        <ProductGroup title="Sonstige / Legacy" emoji="📦" packages={prio5} />
      )}

      {/* ═══ INTERPRETATION ═══ */}
      {analysis && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">📊 Aktueller Stand</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>
              <strong>{analysis.building} Produkte</strong> werden aktuell gebaut (max. 5 parallele Slots).
              {analysis.queued > 0 && <> <strong>{analysis.queued} Produkte</strong> warten in der Warteschlange und werden automatisch gestartet.</>}
            </p>
            {analysis.blocked > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                ⚠️ <strong>{analysis.blocked} Produkte sind blockiert</strong> — der Factory-Orchestrator löst dies automatisch auf, sobald die Curriculum-Daten (Lernfelder & Kompetenzen) bereitstehen.
              </p>
            )}
            {analysis.failed > 0 && (
              <p className="text-destructive">
                ❌ <strong>{analysis.failed} Produkte fehlgeschlagen</strong> — Status kann auf „queued" zurückgesetzt werden für einen Retry.
              </p>
            )}
            <p>
              📅 <strong>Prognose:</strong> Bei ~4h/Produkt und 5 parallelen Slots sind alle {analysis.total} Produkte in ca. <strong>{analysis.estimatedDays} Tagen</strong> fertig 
              (≈ {analysis.estimatedDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}).
              <em className="block text-xs mt-1">Hinweis: Schätzung startet bei null — reale Durchlaufzeiten werden sich mit abgeschlossenen Paketen verfeinern.</em>
            </p>
          </CardContent>
        </Card>
      )}

      {/* ═══ PLATTFORM-KPIs ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Link to="/admin/content" className="block">
          <PlatformCard icon={<FileText className="h-4 w-4" />} label="SEO-Seiten" value={kpis.seoPages} />
        </Link>
        <Link to="/admin/crm" className="block">
          <PlatformCard icon={<Users className="h-4 w-4" />} label="Nutzer" value={kpis.usersTotal} />
        </Link>
        <Link to="/admin/support" className="block">
          <PlatformCard icon={<Headphones className="h-4 w-4" />} label="Tickets offen" value={kpis.ticketsOpen} sublabel={`${kpis.ticketsTotal} gesamt`} alert={kpis.ticketsOpen > 0} />
        </Link>
        <Link to="/admin/business" className="block">
          <PlatformCard icon={<DollarSign className="h-4 w-4" />} label="Umsatz" value={fmtEur(kpis.revenueCents)} sublabel={`${kpis.ordersPaid} Bestellungen`} />
        </Link>
        <PlatformCard icon={<Activity className="h-4 w-4" />} label="KI-Kosten heute" value={`€${dailyCost.toFixed(2)}`} />
      </div>
    </div>
  );
}

// ═══ Sub-Components ═══

function KPICard({ icon, label, value, sublabel, accent, alert: isAlert }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; accent?: string; alert?: boolean;
}) {
  return (
    <Card className={cn(
      "transition-colors",
      isAlert ? "border-destructive/40 bg-destructive/5" : accent || ""
    )}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <p className={cn("text-xl font-bold", isAlert && "text-destructive")}>{value}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}

function PlatformCard({ icon, label, value, sublabel, alert: isAlert }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; alert?: boolean;
}) {
  return (
    <Card className={cn("hover:shadow-md transition-all", isAlert && "border-amber-500/30")}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1 text-muted-foreground">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-lg font-bold">{value}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}

function ProductGroup({ title, emoji, packages }: { title: string; emoji: string; packages: PackageInfo[] }) {
  const done = packages.filter(p => p.status === 'published').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {emoji} {title}
        </CardTitle>
        <CardDescription>{done}/{packages.length} fertig</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Produkt</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Phasen</TableHead>
              <TableHead className="text-right pr-6">Fortschritt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map(pkg => <ProductRow key={pkg.id} pkg={pkg} />)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ProductRow({ pkg }: { pkg: PackageInfo }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const progress = pkg.build_progress || 0;

  const statusBadge = (() => {
    switch (pkg.status) {
      case 'published':
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">Live</Badge>;
      case 'building':
        return <Badge className="bg-primary/10 text-primary border-primary/20 text-xs"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Baut</Badge>;
      case 'queued':
        return <Badge variant="outline" className="text-xs"><Clock className="h-3 w-3 mr-1" />Queue</Badge>;
      case 'blocked':
        return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs"><Pause className="h-3 w-3 mr-1" />Blockiert</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="text-xs">Fehler</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{pkg.status}</Badge>;
    }
  })();

  // Display short title
  const shortTitle = (pkg.title || pkg.id.slice(0, 12)).replace('ExamFit – ', '');

  return (
    <TableRow className={cn(
      pkg.status === 'building' && 'bg-primary/5',
      pkg.status === 'failed' && 'bg-destructive/5',
    )}>
      <TableCell className="pl-6">
        <Link to={`/admin/studio/${pkg.id}`} className="hover:underline font-medium text-sm">
          {shortTitle}
        </Link>
      </TableCell>
      <TableCell>{statusBadge}</TableCell>
      <TableCell>
        <div className="flex gap-0.5">
          {STEP_ORDER.map(step => {
            const s = stepStatuses[step];
            return (
              <div
                key={step}
                className={cn(
                  "w-4 h-2 rounded-sm",
                  s === 'done' || s === 'skipped' ? 'bg-emerald-500' :
                  s === 'running' || s === 'enqueued' ? 'bg-primary animate-pulse' :
                  s === 'failed' ? 'bg-destructive' :
                  'bg-muted'
                )}
                title={`${STEP_LABELS[step] || step}: ${s || 'ausstehend'}`}
              />
            );
          })}
        </div>
      </TableCell>
      <TableCell className="text-right pr-6">
        <div className="flex items-center gap-2 justify-end">
          <Progress value={progress} className="h-1.5 w-20" />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{progress}%</span>
        </div>
      </TableCell>
    </TableRow>
  );
}
