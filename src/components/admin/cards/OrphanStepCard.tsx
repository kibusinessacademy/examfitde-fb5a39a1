import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Wrench, Zap, RefreshCw, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OrphanStep {
  package_id: string;
  step_key: string;
  step_status: string;
  step_age_minutes: number;
  orphan_class: 'guard_swallowed' | 'materializer_gap' | 'orphan_queued';
  guard_evidence: string | null;
  dag_ready: boolean;
  course_title: string | null;
  track: string | null;
}

const CLASS_CONFIG: Record<string, { label: string; tone: string; action: string; actionLabel: string; icon: typeof Wrench }> = {
  guard_swallowed: {
    label: 'Guard-Swallowed',
    tone: 'border-destructive/40 text-destructive bg-destructive/5',
    action: 'enqueue_single_step',
    actionLabel: 'Guard/Step synchronisieren',
    icon: Wrench,
  },
  materializer_gap: {
    label: 'Materializer-Gap',
    tone: 'border-warning/40 text-warning bg-warning/5',
    action: 'enqueue_single_step',
    actionLabel: 'Job materialisieren',
    icon: Zap,
  },
  orphan_queued: {
    label: 'Orphan-Queued',
    tone: 'border-muted-foreground/40 text-muted-foreground bg-muted/5',
    action: 'retry_stalled_step',
    actionLabel: 'Step neu anstoßen',
    icon: RefreshCw,
  },
};

export default function OrphanStepCard() {
  const queryClient = useQueryClient();

  const { data: orphans, isLoading } = useQuery({
    queryKey: ['orphan-step-audit'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ops_orphan_step_audit')
        .select('package_id,step_key,step_status,step_age_minutes,orphan_class,guard_evidence,dag_ready,course_title,track')
        .order('step_age_minutes', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as OrphanStep[];
    },
    refetchInterval: 30_000,
  });

  const healMutation = useMutation({
    mutationFn: async ({ packageId, action, stepKey }: { packageId: string; action: string; stepKey: string }) => {
      return runAdminOpsAction(action as any, { package_id: packageId, step_key: stepKey });
    },
    onSuccess: () => {
      toast.success('Aktion ausgeführt');
      queryClient.invalidateQueries({ queryKey: ['orphan-step-audit'] });
    },
    onError: (e: any) => toast.error(e.message || 'Fehler'),
  });

  if (isLoading || !orphans || orphans.length === 0) return null;

  const byClass = {
    guard_swallowed: orphans.filter(o => o.orphan_class === 'guard_swallowed'),
    materializer_gap: orphans.filter(o => o.orphan_class === 'materializer_gap'),
    orphan_queued: orphans.filter(o => o.orphan_class === 'orphan_queued'),
  };

  const guardCount = byClass.guard_swallowed.length;
  const isCritical = guardCount > 0;

  return (
    <Card className={cn('border', isCritical ? 'border-destructive/30' : 'border-warning/30')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className={cn('h-4 w-4', isCritical ? 'text-destructive' : 'text-warning')} />
          Orphan-Step Audit
          <Badge variant="outline" className="ml-auto text-[10px]">{orphans.length} Steps</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(['guard_swallowed', 'materializer_gap', 'orphan_queued'] as const).map(cls => {
          const items = byClass[cls];
          if (items.length === 0) return null;
          const config = CLASS_CONFIG[cls];
          const Icon = config.icon;

          return (
            <div key={cls} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn('text-[10px]', config.tone)}>
                  {config.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{items.length} Step(s)</span>
              </div>
              {items.slice(0, 5).map(item => (
                <div key={`${item.package_id}-${item.step_key}`} className="rounded-lg border border-border bg-card/50 p-2.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/admin/studio/${item.package_id}`}
                      className="text-xs font-medium text-foreground hover:text-primary transition-colors truncate block"
                    >
                      {item.course_title || item.package_id.slice(0, 8)}
                    </Link>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <code className="bg-muted px-1 rounded text-[9px]">{item.step_key}</code>
                      <span>·</span>
                      <span>{Math.round(item.step_age_minutes)} min</span>
                      {item.dag_ready && <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-success/40 text-success">DAG ✓</Badge>}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] gap-1 shrink-0"
                    disabled={healMutation.isPending}
                    onClick={() => healMutation.mutate({
                      packageId: item.package_id,
                      action: config.action,
                      stepKey: item.step_key,
                    })}
                  >
                    {healMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                    {config.actionLabel}
                  </Button>
                </div>
              ))}
              {items.length > 5 && (
                <p className="text-[10px] text-muted-foreground pl-1">+ {items.length - 5} weitere</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
