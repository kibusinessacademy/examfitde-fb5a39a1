import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from 'react-router-dom';
import { Clock, Loader2, Pause, Snowflake } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackageInfo, STEP_LABELS, STEP_ORDER } from './types';

function getStatusBadge(status: string, priority?: number) {
  // Frozen = queued with priority >= 99 (enrichment block)
  if (status === 'queued' && priority != null && priority >= 99) {
    return <Badge className="bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 text-xs"><Snowflake className="h-3 w-3 mr-1" />Frozen</Badge>;
  }
  switch (status) {
    case 'published': return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">Live</Badge>;
    case 'building': return <Badge className="bg-primary/10 text-primary border-primary/20 text-xs"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Baut</Badge>;
    case 'queued': return <Badge variant="outline" className="text-xs"><Clock className="h-3 w-3 mr-1" />Queue</Badge>;
    case 'blocked': return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs"><Pause className="h-3 w-3 mr-1" />Blockiert</Badge>;
    case 'failed': return <Badge variant="destructive" className="text-xs">Fehler</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function getShortTitle(pkg: PackageInfo) {
  return (pkg.title || pkg.id.slice(0, 12)).replace('ExamFit – ', '');
}

function StepBar({ stepStatuses }: { stepStatuses: Record<string, string> }) {
  return (
    <div className="flex gap-0.5">
      {STEP_ORDER.map(step => {
        const s = stepStatuses[step];
        return (
          <div key={step} className={cn("flex-1 h-2 rounded-sm",
            s === 'done' || s === 'skipped' ? 'bg-emerald-500' :
            s === 'running' || s === 'enqueued' ? 'bg-primary animate-pulse' :
            s === 'failed' ? 'bg-destructive' : 'bg-muted'
          )} title={`${STEP_LABELS[step] || step}: ${s || 'ausstehend'}`} />
        );
      })}
    </div>
  );
}

function ProductCard({ pkg }: { pkg: PackageInfo }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const progress = pkg.build_progress || 0;
  return (
    <Link to={`/admin/studio/${pkg.id}`} className={cn("block rounded-lg border p-3 transition-colors active:bg-muted/50", pkg.status === 'building' && 'border-primary/30 bg-primary/5', pkg.status === 'failed' && 'border-destructive/30 bg-destructive/5')}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-medium text-sm truncate">{getShortTitle(pkg)}</span>
        {getStatusBadge(pkg.status, pkg.priority)}
      </div>
      <StepBar stepStatuses={stepStatuses} />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground">{pkg.current_step ? STEP_LABELS[pkg.current_step] || pkg.current_step : '—'}</span>
        <div className="flex items-center gap-2"><Progress value={progress} className="h-1.5 w-16" /><span className="text-xs font-mono text-muted-foreground">{progress}%</span></div>
      </div>
    </Link>
  );
}

function ProductRow({ pkg }: { pkg: PackageInfo }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const progress = pkg.build_progress || 0;
  return (
    <TableRow className={cn(pkg.status === 'building' && 'bg-primary/5', pkg.status === 'failed' && 'bg-destructive/5')}>
      <TableCell className="pl-6"><Link to={`/admin/studio/${pkg.id}`} className="hover:underline font-medium text-sm">{getShortTitle(pkg)}</Link></TableCell>
      <TableCell>{getStatusBadge(pkg.status, pkg.priority)}</TableCell>
      <TableCell><div className="flex gap-0.5">{STEP_ORDER.map(step => { const s = stepStatuses[step]; return <div key={step} className={cn("w-4 h-2 rounded-sm", s === 'done' || s === 'skipped' ? 'bg-emerald-500' : s === 'running' || s === 'enqueued' ? 'bg-primary animate-pulse' : s === 'failed' ? 'bg-destructive' : 'bg-muted')} title={`${STEP_LABELS[step] || step}: ${s || 'ausstehend'}`} />; })}</div></TableCell>
      <TableCell className="text-right pr-6"><div className="flex items-center gap-2 justify-end"><Progress value={progress} className="h-1.5 w-20" /><span className="text-xs font-mono text-muted-foreground w-8 text-right">{progress}%</span></div></TableCell>
    </TableRow>
  );
}

export function ProductGroup({ title, emoji, packages, isMobile }: { title: string; emoji: string; packages: PackageInfo[]; isMobile: boolean }) {
  const done = packages.filter(p => p.status === 'published').length;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2">{emoji} {title}</CardTitle><CardDescription>{done}/{packages.length} fertig</CardDescription></CardHeader>
      <CardContent className={isMobile ? "px-3 pb-3" : "p-0"}>
        {isMobile ? <div className="space-y-2">{packages.map(pkg => <ProductCard key={pkg.id} pkg={pkg} />)}</div> : (
          <Table><TableHeader><TableRow><TableHead className="pl-6">Produkt</TableHead><TableHead>Status</TableHead><TableHead>Phasen</TableHead><TableHead className="text-right pr-6">Fortschritt</TableHead></TableRow></TableHeader><TableBody>{packages.map(pkg => <ProductRow key={pkg.id} pkg={pkg} />)}</TableBody></Table>
        )}
      </CardContent>
    </Card>
  );
}
