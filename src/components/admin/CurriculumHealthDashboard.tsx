import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle, Search,
  RefreshCw, BookOpen, Brain, Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import EliteHealthBadge from '@/components/admin/EliteHealthBadge';

interface CurriculumHealth {
  id: string;
  title: string;
  beruf_id: string;
  beruf_name: string;
  status: string;
  lf_count: number;
  competency_count: number;
  has_package: boolean;
  package_status: string | null;
}

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  frozen: { label: 'Frozen ✓', color: 'bg-success/20 text-success' },
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground' },
  review: { label: 'Review', color: 'bg-warning/20 text-warning' },
  error: { label: 'Fehler', color: 'bg-destructive/20 text-destructive' },
};

export default function CurriculumHealthDashboard() {
  const [data, setData] = useState<CurriculumHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    // Load curricula with beruf info
    const { data: curricula } = await (supabase as any).from('curricula')
      .select('id, title, beruf_id, status')
      .order('title');

    if (!curricula) { setLoading(false); return; }

    // Load beruf names
    const berufIds = [...new Set(curricula.map((c: any) => c.beruf_id).filter(Boolean))];
    const { data: berufe } = await (supabase as any).from('berufe')
      .select('id, bezeichnung_kurz')
      .in('id', berufIds);
    const berufMap = new Map((berufe || []).map((b: any) => [b.id, b.bezeichnung_kurz]));

    // Load LF counts
    const { data: lfCounts } = await (supabase as any).rpc('get_curriculum_lf_counts')
      .catch(() => ({ data: null }));

    // Load competency counts  
    const { data: compCounts } = await (supabase as any).rpc('get_curriculum_competency_counts')
      .catch(() => ({ data: null }));

    // Load packages
    const { data: packages } = await (supabase as any).from('course_packages')
      .select('curriculum_id, certification_id, status');

    const lfMap = new Map<string, number>((lfCounts || []).map((r: any) => [r.curriculum_id, r.count]));
    const compMap = new Map<string, number>((compCounts || []).map((r: any) => [r.curriculum_id, r.count]));
    const pkgMap = new Map<string, string>((packages || []).map((p: any) => [p.curriculum_id || p.certification_id, p.status]));

    // Fallback: count LFs and competencies directly if RPCs don't exist
    const lfFallback = new Map<string, number>();
    const compFallback = new Map<string, number>();
    if (!lfCounts) {
      const { data: lfs } = await (supabase as any).from('learning_fields')
        .select('curriculum_id');
      if (lfs) {
        for (const lf of lfs) {
          lfFallback.set(lf.curriculum_id, (lfFallback.get(lf.curriculum_id) || 0) + 1);
        }
      }
    }
    if (!compCounts) {
      const { data: lfs } = await (supabase as any).from('learning_fields')
        .select('id, curriculum_id');
      if (lfs) {
        const lfIds = lfs.map((l: any) => l.id);
        const lfToCurr = new Map(lfs.map((l: any) => [l.id, l.curriculum_id]));
        const { data: comps } = await (supabase as any).from('competencies')
          .select('learning_field_id')
          .in('learning_field_id', lfIds.slice(0, 500));
        if (comps) {
          for (const c of comps) {
            const currId = lfToCurr.get(c.learning_field_id) as string | undefined;
            if (currId) compFallback.set(currId, (compFallback.get(currId) || 0) + 1);
          }
        }
      }
    }

    const result: CurriculumHealth[] = curricula.map((c: any) => ({
      id: c.id,
      title: c.title || 'Unbenannt',
      beruf_id: c.beruf_id,
      beruf_name: berufMap.get(c.beruf_id) || '–',
      status: c.status || 'draft',
      lf_count: lfMap.get(c.id) ?? lfFallback.get(c.id) ?? 0,
      competency_count: compMap.get(c.id) ?? compFallback.get(c.id) ?? 0,
      has_package: pkgMap.has(c.beruf_id),
      package_status: pkgMap.get(c.beruf_id) || null,
    }));

    setData(result);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = data.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return c.title.toLowerCase().includes(q) || c.beruf_name.toLowerCase().includes(q);
    }
    return true;
  });

  const statusCounts = data.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const healthyCount = data.filter(c => c.status === 'frozen' && c.lf_count > 0 && c.competency_count > 0).length;
  const emptyCount = data.filter(c => c.lf_count === 0 || c.competency_count === 0).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Curricula</p>
            <p className="text-2xl font-bold text-foreground">{data.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Frozen (Ready)</p>
            <p className="text-2xl font-bold text-success">{healthyCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Leer (kein LF)</p>
            <p className="text-2xl font-bold text-destructive">{emptyCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mit Paket</p>
            <p className="text-2xl font-bold text-primary">{data.filter(c => c.has_package).length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Beruf oder Curriculum suchen…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex gap-1">
          <Badge
            variant="outline"
            className={cn("cursor-pointer text-xs", !statusFilter && "bg-primary/10 text-primary")}
            onClick={() => setStatusFilter(null)}
          >
            Alle ({data.length})
          </Badge>
          {Object.entries(statusCounts).map(([status, count]) => {
            const cfg = STATUS_STYLES[status] || STATUS_STYLES.draft;
            return (
              <Badge
                key={status}
                variant="outline"
                className={cn("cursor-pointer text-xs", statusFilter === status && cfg.color)}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              >
                {cfg.label}: {count}
              </Badge>
            );
          })}
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="h-8">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Beruf</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">Status</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-16">
                  <span className="flex items-center justify-center gap-1"><BookOpen className="h-3 w-3" /> LF</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">
                  <span className="flex items-center justify-center gap-1"><Brain className="h-3 w-3" /> Komp.</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">
                  <span className="flex items-center justify-center gap-1"><Layers className="h-3 w-3" /> Paket</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-16">Health</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isHealthy = c.status === 'frozen' && c.lf_count > 0 && c.competency_count > 0;
                const isEmpty = c.lf_count === 0;
                const cfg = STATUS_STYLES[c.status] || STATUS_STYLES.draft;
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2">
                      <p className="font-medium text-foreground truncate max-w-xs">{c.beruf_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{c.title}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className={cn("text-[10px]", cfg.color)}>{cfg.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      <span className={cn(c.lf_count === 0 ? 'text-destructive' : 'text-foreground')}>{c.lf_count}</span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      <span className={cn(c.competency_count === 0 ? 'text-destructive' : 'text-foreground')}>{c.competency_count}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.has_package ? (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">{c.package_status}</Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isHealthy ? (
                        <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
                      ) : isEmpty ? (
                        <XCircle className="h-4 w-4 text-destructive mx-auto" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-warning mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Elite Health Summary */}
      <Card>
        <CardContent className="py-4">
          <CardTitle className="text-sm mb-3">Elite-Readiness Übersicht</CardTitle>
          <EliteHealthBadge />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {filtered.length} von {data.length} Curricula angezeigt
      </p>
    </div>
  );
}
