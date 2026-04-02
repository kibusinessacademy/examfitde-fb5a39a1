import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Link } from 'react-router-dom';
import { Clock, Loader2, Pause, Snowflake, ChevronDown, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackageInfo } from './types';
import { PIPELINE_STEP_SHORT_LABELS, FULL_STEP_ORDER } from '@/lib/pipeline-steps';
const STEP_LABELS = PIPELINE_STEP_SHORT_LABELS as Record<string, string>;
const STEP_ORDER = FULL_STEP_ORDER as readonly string[];
import { deriveStepProgress } from '@/lib/pipeline-steps';

function getStatusBadge(status: string, priority?: number) {
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
  // Detect fanout-active: parent step queued but fanout prerequisite done
  const fanoutActive = stepStatuses['generate_learning_content'] === 'queued'
    && stepStatuses['fanout_learning_content'] === 'done';

  return (
    <div className="flex gap-0.5">
      {STEP_ORDER.map(step => {
        let s = stepStatuses[step];
        // Override: show fanout-active step as running
        if (step === 'generate_learning_content' && s === 'queued' && fanoutActive) {
          s = 'running';
        }
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

/** Status priority for picking the "lead" package in a curriculum group */
const STATUS_RANK: Record<string, number> = {
  building: 1, failed: 2, queued: 3, blocked: 4, draft: 5, published: 6, planning: 7,
};

interface CurriculumGroup {
  curriculum_id: string;
  lead: PackageInfo;
  versions: PackageInfo[];
}

function groupByCurriculum(packages: PackageInfo[]): CurriculumGroup[] {
  const map = new Map<string, PackageInfo[]>();
  const ungrouped: PackageInfo[] = [];

  for (const pkg of packages) {
    const key = pkg.curriculum_id || pkg.id; // fallback to pkg id if no curriculum
    if (!pkg.curriculum_id) {
      ungrouped.push(pkg);
      continue;
    }
    const list = map.get(key) || [];
    list.push(pkg);
    map.set(key, list);
  }

  const groups: CurriculumGroup[] = [];
  for (const [curriculum_id, versions] of map) {
    versions.sort((a, b) => (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99));
    groups.push({ curriculum_id, lead: versions[0], versions });
  }
  // Add ungrouped as single-version groups
  for (const pkg of ungrouped) {
    groups.push({ curriculum_id: pkg.id, lead: pkg, versions: [pkg] });
  }

  // Sort groups by lead status rank, then priority
  groups.sort((a, b) => {
    const ra = STATUS_RANK[a.lead.status] ?? 99;
    const rb = STATUS_RANK[b.lead.status] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.lead.priority - b.lead.priority;
  });

  return groups;
}

function ProductCard({ pkg }: { pkg: PackageInfo }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const { progress, currentLabel, isActive } = deriveStepProgress(pkg.step_status_json);
  return (
    <Link to={`/admin/studio/${pkg.id}`} className={cn("block rounded-lg border p-3 transition-colors active:bg-muted/50", pkg.status === 'building' && 'border-primary/30 bg-primary/5', pkg.status === 'failed' && 'border-destructive/30 bg-destructive/5')}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-medium text-sm truncate">{getShortTitle(pkg)}</span>
        {getStatusBadge(pkg.status, pkg.priority)}
      </div>
      <StepBar stepStatuses={stepStatuses} />
      <div className="flex items-center justify-between mt-2">
        <span className={cn("text-[10px] text-muted-foreground", isActive && "text-primary font-medium")}>{currentLabel}</span>
        <div className="flex items-center gap-2"><Progress value={progress} className="h-1.5 w-16" /><span className="text-xs font-mono text-muted-foreground">{progress}%</span></div>
      </div>
    </Link>
  );
}

function CurriculumCardGroup({ group }: { group: CurriculumGroup }) {
  const [open, setOpen] = useState(false);
  const hasMultiple = group.versions.length > 1;

  if (!hasMultiple) {
    return <ProductCard pkg={group.lead} />;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border overflow-hidden">
        <CollapsibleTrigger className="w-full">
          <div className={cn("flex items-center justify-between gap-2 p-3 hover:bg-muted/30 transition-colors", group.lead.status === 'building' && 'border-primary/30 bg-primary/5')}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-sm truncate">{getShortTitle(group.lead)}</span>
              <Badge variant="outline" className="text-[10px] shrink-0 gap-0.5">
                <Layers className="h-2.5 w-2.5" />{group.versions.length}
              </Badge>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {getStatusBadge(group.lead.status, group.lead.priority)}
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t space-y-1 p-2">
            {group.versions.map(pkg => (
              <ProductCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ProductRow({ pkg, isSubRow }: { pkg: PackageInfo; isSubRow?: boolean }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const { progress } = deriveStepProgress(pkg.step_status_json);
  return (
    <TableRow className={cn(pkg.status === 'building' && 'bg-primary/5', pkg.status === 'failed' && 'bg-destructive/5', isSubRow && 'bg-muted/20')}>
      <TableCell className={cn("pl-6", isSubRow && "pl-10")}>
        <Link to={`/admin/studio/${pkg.id}`} className="hover:underline font-medium text-sm">
          {isSubRow ? <span className="text-muted-foreground">↳ </span> : null}{getShortTitle(pkg)}
        </Link>
      </TableCell>
      <TableCell><StepBar stepStatuses={stepStatuses} /></TableCell>
      <TableCell className="text-right pr-6"><div className="flex items-center gap-2 justify-end"><Progress value={progress} className="h-1.5 w-20" /><span className="text-xs font-mono text-muted-foreground w-8 text-right">{progress}%</span></div></TableCell>
    </TableRow>
  );
}

function CurriculumRowGroup({ group }: { group: CurriculumGroup }) {
  const [open, setOpen] = useState(false);

  if (group.versions.length === 1) {
    return <ProductRow pkg={group.lead} />;
  }

  return (
    <>
      <TableRow
        className={cn("cursor-pointer hover:bg-muted/30", group.lead.status === 'building' && 'bg-primary/5')}
        onClick={() => setOpen(!open)}
      >
        <TableCell className="pl-6">
          <div className="flex items-center gap-2">
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
            <Link to={`/admin/studio/${group.lead.id}`} className="hover:underline font-medium text-sm" onClick={e => e.stopPropagation()}>
              {getShortTitle(group.lead)}
            </Link>
            <Badge variant="outline" className="text-[10px] gap-0.5">
              <Layers className="h-2.5 w-2.5" />{group.versions.length}
            </Badge>
          </div>
        </TableCell>
        <TableCell>{getStatusBadge(group.lead.status, group.lead.priority)}</TableCell>
        <TableCell>
          <div className="flex gap-1">
            {group.versions.map(v => (
              <div key={v.id} className={cn("w-2 h-2 rounded-full",
                v.status === 'published' ? 'bg-emerald-500' :
                v.status === 'building' ? 'bg-primary animate-pulse' :
                v.status === 'failed' ? 'bg-destructive' : 'bg-muted'
              )} title={`${v.status}`} />
            ))}
          </div>
        </TableCell>
        <TableCell className="text-right pr-6">
          <span className="text-xs text-muted-foreground">{group.versions.filter(v => v.status === 'published').length}/{group.versions.length} live</span>
        </TableCell>
      </TableRow>
      {open && group.versions.map(pkg => (
        <ProductRow key={pkg.id} pkg={pkg} isSubRow />
      ))}
    </>
  );
}

export function ProductGroup({ title, emoji, packages, isMobile }: { title: string; emoji: string; packages: PackageInfo[]; isMobile: boolean }) {
  const groups = groupByCurriculum(packages);
  const done = packages.filter(p => p.status === 'published').length;
  const dupeCount = groups.filter(g => g.versions.length > 1).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {emoji} {title}
          {dupeCount > 0 && (
            <Badge variant="outline" className="text-[10px] gap-0.5 text-amber-600 dark:text-amber-400 border-amber-500/30">
              <Layers className="h-2.5 w-2.5" />{dupeCount} Mehrfach
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{done}/{packages.length} fertig · {groups.length} Curricula</CardDescription>
      </CardHeader>
      <CardContent className={isMobile ? "px-3 pb-3" : "p-0"}>
        {isMobile ? (
          <div className="space-y-2">
            {groups.map(g => <CurriculumCardGroup key={g.curriculum_id} group={g} />)}
          </div>
        ) : (
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
              {groups.map(g => <CurriculumRowGroup key={g.curriculum_id} group={g} />)}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
