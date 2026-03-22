import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Search, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_FILTERS = [
  { key: 'all', label: 'Alle' },
  { key: 'ready_for_approval', label: '🟢 Publish-Ready' },
  { key: 'waiting_for_council', label: '🟡 Council offen' },
  { key: 'early_pipeline', label: '⚪ Frühe Pipeline' },
  { key: 'building', label: 'Building' },
  { key: 'council_review', label: 'Council' },
  { key: 'queued', label: 'Queued' },
  { key: 'published', label: 'Published' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'failed', label: 'Failed' },
  { key: 'stuck', label: 'Festgefahren' },
  { key: 'publish_drift', label: 'Publish Drift' },
] as const;

function statusBadge(pkg: AdminPackageSSOT) {
  const badges: { label: string; className: string }[] = [];

  const statusMap: Record<string, { label: string; className: string }> = {
    published: { label: 'Veröffentlicht', className: 'bg-success/10 text-success border-success/30' },
    building: { label: 'Building', className: 'bg-primary/10 text-primary border-primary/30' },
    council_review: { label: 'Council', className: 'bg-warning/10 text-warning border-warning/30' },
    queued: { label: 'Queued', className: 'bg-muted text-muted-foreground border-border' },
    blocked: { label: 'Blockiert', className: 'bg-destructive/10 text-destructive border-destructive/30' },
    failed: { label: 'Fehlgeschlagen', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  };
  const s = statusMap[pkg.status] || { label: pkg.status, className: 'bg-muted text-muted-foreground border-border' };
  badges.push(s);

  if (pkg.is_stuck) badges.push({ label: 'Festgefahren', className: 'bg-destructive/10 text-destructive border-destructive/30' });
  if (pkg.has_publish_drift) badges.push({ label: 'Publish Drift', className: 'bg-destructive/10 text-destructive border-destructive/30' });
  if (pkg.has_stale_publish) badges.push({ label: 'Stale Publish', className: 'bg-warning/10 text-warning border-warning/30' });
  if (pkg.council_complete && !pkg.council_approved) badges.push({ label: 'Council ✓ / Approval ✗', className: 'bg-warning/10 text-warning border-warning/30' });
  if (pkg.council_sessions_pending > 0) badges.push({ label: `Council ${pkg.council_sessions_pending} offen`, className: 'bg-warning/10 text-warning border-warning/30' });
  if (pkg.jobs_failed > 0) badges.push({ label: `${pkg.jobs_failed} Jobs failed`, className: 'bg-destructive/10 text-destructive border-destructive/30' });

  return badges;
}

function PackageRow({ pkg }: { pkg: AdminPackageSSOT }) {
  const title = pkg.canonical_title || pkg.raw_title || 'Unbenannt';
  const badges = statusBadge(pkg);

  return (
    <Link
      to={`/admin/studio/${pkg.package_id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground font-mono">{pkg.package_id.slice(0, 8)}</span>
          {pkg.priority != null && (
            <span className="text-[10px] text-muted-foreground">P{pkg.priority}</span>
          )}
          {pkg.approved_questions > 0 && (
            <span className="text-[10px] text-muted-foreground">{pkg.approved_questions} Fragen</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {badges.map((b, i) => (
            <Badge key={i} variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", b.className)}>
              {b.label}
            </Badge>
          ))}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

export default function KursePage() {
  const { data: packages, isLoading, error } = useAdminPackagesSSOT();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (!packages) return [];
    let list = packages;

    // Smart segments
    if (statusFilter === 'ready_for_approval') {
      list = list.filter(p => p.council_complete && !p.council_approved && p.approved_questions > 0);
    } else if (statusFilter === 'waiting_for_council') {
      list = list.filter(p => p.council_sessions_pending > 0);
    } else if (statusFilter === 'early_pipeline') {
      list = list.filter(p => p.approved_questions === 0 && !p.council_complete && p.status !== 'published');
    } else if (statusFilter === 'stuck') {
      list = list.filter(p => p.is_stuck);
    } else if (statusFilter === 'publish_drift') {
      list = list.filter(p => p.has_publish_drift);
    } else if (statusFilter !== 'all') {
      list = list.filter(p => p.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.canonical_title || p.raw_title || '').toLowerCase().includes(q) ||
        p.package_id.toLowerCase().includes(q)
      );
    }

    return list;
  }, [packages, search, statusFilter]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Fehler: {(error as Error).message}
      </div>
    );
  }

  const isFallback = packages?.some(p => p._source === 'fallback_course_packages');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground">Kurse</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Kanonische Paketliste · SSOT</p>
        </div>
        {isFallback && (
          <Badge variant="outline" className="border-amber-500/50 text-amber-600 text-[10px] px-1.5 py-0.5">
            Fallback-Modus
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suchen nach Name oder ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                statusFilter === f.key
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
              {f.key !== 'all' && packages && (
                <span className="ml-1 text-[10px] opacity-60">
                  {f.key === 'stuck'
                    ? packages.filter(p => p.is_stuck).length
                    : f.key === 'publish_drift'
                    ? packages.filter(p => p.has_publish_drift).length
                    : f.key === 'ready_for_approval'
                    ? packages.filter(p => p.council_complete && !p.council_approved && p.approved_questions > 0).length
                    : f.key === 'waiting_for_council'
                    ? packages.filter(p => p.council_sessions_pending > 0).length
                    : f.key === 'early_pipeline'
                    ? packages.filter(p => p.approved_questions === 0 && !p.council_complete && p.status !== 'published').length
                    : packages.filter(p => p.status === f.key).length
                  }
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Keine Pakete gefunden.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(pkg => (
            <PackageRow key={pkg.package_id} pkg={pkg} />
          ))}
        </div>
      )}
    </div>
  );
}
