import { useSSOTHealthMetrics } from '@/hooks/useSSOTHealthMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Ghost, GitBranch, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

function MetricTile({ label, value, icon: Icon, tone }: {
  label: string; value: number; icon: typeof Ghost;
  tone: 'success' | 'warning' | 'destructive';
}) {
  const colors = {
    success: 'border-primary/30 bg-primary/5 text-primary',
    warning: 'border-warning/30 bg-warning/5 text-warning',
    destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
  };
  const effective = value === 0 ? 'success' : tone;
  return (
    <div className={`rounded-lg border p-3 ${colors[effective]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

export default function SSOTHealthCard() {
  const { data, isLoading, error } = useSSOTHealthMetrics();

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error) return <div className="text-xs text-destructive">Fehler beim Laden der SSOT-Metriken</div>;
  if (!data) return null;

  const allClear = data.ghostSuccesses === 0 && data.jobStepDrifts === 0 && data.processingLeaks === 0;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            {allClear ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
            SSOT Pipeline-Integrität
          </span>
          <Badge variant={allClear ? 'default' : 'destructive'} className="text-[10px]">
            {allClear ? 'Stabil' : 'Auffälligkeiten'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <MetricTile label="Ghost-Erfolge" value={data.ghostSuccesses} icon={Ghost} tone="destructive" />
          <MetricTile label="Job/Step-Drift" value={data.jobStepDrifts} icon={GitBranch} tone="destructive" />
          <MetricTile label="Processing-Leaks" value={data.processingLeaks} icon={Clock} tone="warning" />
          <MetricTile label="HARD_FAILs" value={data.newHardFails} icon={AlertTriangle} tone="warning" />
        </div>

        {data.hardFailsByStep.length > 0 && (
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div className="font-medium mb-1">HARD_FAIL nach Step:</div>
            {data.hardFailsByStep.map(r => (
              <div key={r.step_key} className="flex justify-between">
                <span className="font-mono">{r.step_key}</span>
                <span>{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
