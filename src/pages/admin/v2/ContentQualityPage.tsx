import { useState, useMemo, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Search, Play, Download, AlertTriangle, ShieldAlert,
  BookOpen, GraduationCap, FileText, ChevronRight,
} from 'lucide-react';
import { ContentQualityFindingDrawer } from '@/components/admin/content-quality/ContentQualityFindingDrawer';

// ── Types ──

type Severity = 'info' | 'warning' | 'error' | 'critical';
type FindingStatus = 'open' | 'rehealing' | 'resolved' | 'ignored';

interface PackageRow {
  package_id: string;
  package_title: string | null;
  package_status: string;
  track: string | null;
  last_scanned_at: string | null;
  open_findings: number;
  critical_count: number;
  error_count: number;
  warning_count: number;
  info_count: number;
  overall_severity: Severity;
  reheal_recommended: boolean;
}

export interface FindingRow {
  id: string;
  audit_run_id: string;
  package_id: string;
  artifact_type: string;
  artifact_id: string;
  severity: Severity;
  status: FindingStatus;
  title: string | null;
  excerpt: string | null;
  generic_phrase_count: number;
  spelling_error_count: number;
  generic_ratio: number;
  generic_phrases: string[];
  spelling_errors: string[];
  auto_reheal_eligible: boolean;
  reheal_job_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Severity helpers ──

const severityConfig: Record<Severity, { label: string; class: string; order: number }> = {
  critical: { label: 'Critical', class: 'bg-rose-500/15 text-rose-400 border-rose-500/30', order: 0 },
  error: { label: 'Error', class: 'bg-orange-500/15 text-orange-400 border-orange-500/30', order: 1 },
  warning: { label: 'Warning', class: 'bg-amber-500/15 text-amber-400 border-amber-500/30', order: 2 },
  info: { label: 'Info', class: 'bg-muted text-muted-foreground border-border', order: 3 },
};

const artifactIcons: Record<string, typeof BookOpen> = {
  handbook_chapter: BookOpen,
  lesson: GraduationCap,
  tutor_snippet: FileText,
  oral_exam_feedback: FileText,
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const c = severityConfig[severity];
  return <Badge variant="outline" className={cn('text-[10px] font-mono', c.class)}>{c.label}</Badge>;
}

// ── Page ──

export default function ContentQualityPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [onlyReheal, setOnlyReheal] = useState(false);
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<FindingRow | null>(null);

  // ── Packages query ──
  const { data: packages, isLoading: pkgLoading } = useQuery({
    queryKey: ['content-quality-packages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_admin_content_quality_packages' as any)
        .select('*')
        .gt('open_findings', 0)
        .order('critical_count', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PackageRow[];
    },
    staleTime: 60_000,
  });

  // ── Findings for selected package ──
  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: ['content-quality-findings', selectedPkgId],
    queryFn: async () => {
      if (!selectedPkgId) return [];
      const { data, error } = await supabase
        .from('v_admin_content_quality_findings' as any)
        .select('*')
        .eq('package_id', selectedPkgId)
        .eq('status', 'open')
        .order('severity', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as FindingRow[];
    },
    enabled: !!selectedPkgId,
  });

  // ── Run audit mutation ──
  const runAudit = useMutation({
    mutationFn: async () => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectId}.supabase.co/functions/v1/content-quality-audit`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: JSON.stringify({ scope: 'published_packages' }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Audit abgeschlossen: ${data.finding_count} Findings, ${data.critical_count} Critical`);
      qc.invalidateQueries({ queryKey: ['content-quality-packages'] });
    },
    onError: (e) => toast.error(`Audit fehlgeschlagen: ${e.message}`),
  });

  // ── Filtered packages ──
  const filtered = useMemo(() => {
    if (!packages) return [];
    return packages.filter(p => {
      if (search && !p.package_title?.toLowerCase().includes(search.toLowerCase()) && !p.package_id.includes(search)) return false;
      if (severityFilter !== 'all' && p.overall_severity !== severityFilter) return false;
      if (onlyCritical && p.overall_severity !== 'critical') return false;
      if (onlyReheal && !p.reheal_recommended) return false;
      return true;
    });
  }, [packages, search, severityFilter, onlyCritical, onlyReheal]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    if (!packages) return { total: 0, withFindings: 0, critical: 0, totalFindings: 0, reheal: 0 };
    return {
      total: packages.length,
      withFindings: packages.filter(p => p.open_findings > 0).length,
      critical: packages.filter(p => p.overall_severity === 'critical').length,
      totalFindings: packages.reduce((s, p) => s + p.open_findings, 0),
      reheal: packages.filter(p => p.reheal_recommended).length,
    };
  }, [packages]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Content Quality Audit</h1>
          <p className="text-xs text-muted-foreground">Generischen KI-Content in veröffentlichten Paketen erkennen und beheben</p>
        </div>
        <Button onClick={() => runAudit.mutate()} disabled={runAudit.isPending} size="sm" className="gap-2">
          <Play className="h-3.5 w-3.5" />
          {runAudit.isPending ? 'Läuft…' : 'Audit starten'}
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="Pakete mit Findings" value={kpis.withFindings} />
        <KpiCard label="Critical" value={kpis.critical} tone={kpis.critical > 0 ? 'red' : 'green'} />
        <KpiCard label="Offene Findings" value={kpis.totalFindings} />
        <KpiCard label="Reheal empfohlen" value={kpis.reheal} tone={kpis.reheal > 0 ? 'yellow' : 'green'} />
        <KpiCard label="Gescannt" value={kpis.total} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Paket suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[130px] h-9 text-sm">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Switch checked={onlyCritical} onCheckedChange={setOnlyCritical} className="scale-75" />
          Nur Critical
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Switch checked={onlyReheal} onCheckedChange={setOnlyReheal} className="scale-75" />
          Nur Reheal
        </label>
      </div>

      {/* Package Table + Findings split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Package list */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground">Pakete ({filtered.length})</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {pkgLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 mx-3 my-2 rounded-lg" />)
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Keine Pakete mit Findings</div>
            ) : (
              filtered.map(pkg => (
                <button
                  key={pkg.package_id}
                  onClick={() => setSelectedPkgId(pkg.package_id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors flex items-center gap-3',
                    selectedPkgId === pkg.package_id && 'bg-primary/5 border-l-2 border-primary',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{pkg.package_title || pkg.package_id.slice(0, 8)}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <SeverityBadge severity={pkg.overall_severity} />
                      <span className="text-[10px] text-muted-foreground">
                        {pkg.open_findings} Findings · {pkg.critical_count}C / {pkg.error_count}E / {pkg.warning_count}W
                      </span>
                    </div>
                  </div>
                  {pkg.reheal_recommended && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Findings list */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground">
              {selectedPkgId ? `Findings (${findings?.length ?? 0})` : 'Paket auswählen'}
            </span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {!selectedPkgId ? (
              <div className="p-6 text-center text-sm text-muted-foreground">← Paket links auswählen</div>
            ) : findingsLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 mx-3 my-2 rounded-lg" />)
            ) : !findings?.length ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Keine offenen Findings</div>
            ) : (
              findings.map(f => {
                const ArtIcon = artifactIcons[f.artifact_type] ?? FileText;
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFinding(f)}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <ArtIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate flex-1">{f.title || f.artifact_id.slice(0, 8)}</span>
                      <SeverityBadge severity={f.severity} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{f.excerpt}</div>
                    <div className="mt-1 flex gap-2 flex-wrap">
                      {f.generic_phrases.slice(0, 3).map((p, i) => (
                        <span key={i} className="text-[9px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded-full">„{p}"</span>
                      ))}
                      {f.spelling_errors.slice(0, 2).map((e, i) => (
                        <span key={i} className="text-[9px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded-full">{e}</span>
                      ))}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Finding Drawer */}
      <ContentQualityFindingDrawer
        finding={selectedFinding}
        onClose={() => setSelectedFinding(null)}
        onStatusChange={() => {
          qc.invalidateQueries({ queryKey: ['content-quality-findings', selectedPkgId] });
          qc.invalidateQueries({ queryKey: ['content-quality-packages'] });
          setSelectedFinding(null);
        }}
      />
    </div>
  );
}

// ── KPI Card ──

function KpiCard({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'yellow' | 'green' }) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      tone === 'red' ? 'border-rose-500/30 bg-rose-500/5' :
      tone === 'yellow' ? 'border-amber-500/30 bg-amber-500/5' :
      tone === 'green' ? 'border-emerald-500/30 bg-emerald-500/5' :
      'border-border bg-card',
    )}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
