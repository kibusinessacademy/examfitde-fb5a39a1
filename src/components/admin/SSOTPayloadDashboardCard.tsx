import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Wrench, UserX, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface DashboardData {
  violations_24h: number;
  auto_repaired_24h: number;
  hard_blocked_24h: number;
  unknown_producers_24h: number;
  top_producers: { producer: string; violations: number }[];
  hard_block_at: string;
  hard_block_in_hours: number;
}

function Tile({ label, value, icon: Icon, tone }: {
  label: string; value: number | string; icon: typeof AlertTriangle;
  tone: 'success' | 'warning' | 'destructive' | 'neutral';
}) {
  const map = {
    success: 'border-primary/30 bg-primary/5 text-primary',
    warning: 'border-warning/30 bg-warning-bg-subtle text-warning',
    destructive: 'border-destructive/30 bg-destructive-bg-subtle text-destructive',
    neutral: 'border-border bg-card text-foreground',
  };
  return (
    <div className={`rounded-lg border p-3 ${map[tone]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

export default function SSOTPayloadDashboardCard() {
  const [running, setRunning] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ssot-payload-dashboard'],
    queryFn: async (): Promise<DashboardData> => {
      const { data, error } = await (supabase as any).rpc('admin_get_ssot_dashboard');
      if (error) throw error;
      return data as DashboardData;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  async function runRegression() {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).rpc('admin_ssot_producer_regression_test', { p_minutes: 60 });
      if (error) throw error;
      const passed = (data as any)?.passed;
      toast[passed ? 'success' : 'error'](
        passed ? 'Regression PASSED' : 'Regression FAILED',
        { description: `Samples: ${(data as any)?.total_samples ?? 0}` }
      );
      refetch();
    } catch (e: any) {
      toast.error('Regression-Lauf fehlgeschlagen', { description: e.message });
    }
    setRunning(false);
  }

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (error || !data) return <div className="text-xs text-destructive">Fehler beim Laden des SSOT-Dashboards</div>;

  const allClear = data.violations_24h === 0 && data.hard_blocked_24h === 0;
  const hoursLeft = data.hard_block_in_hours;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            {allClear ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
            SSOT Payload Validation
          </span>
          <div className="flex items-center gap-2">
            <Badge variant={hoursLeft > 24 ? 'secondary' : 'destructive'} className="text-[10px]">
              <Clock className="h-3 w-3 mr-1" />
              Hard-Block in {Math.floor(hoursLeft)}h
            </Badge>
            <Button size="sm" variant="outline" disabled={running} onClick={runRegression}>
              <PlayCircle className="h-3.5 w-3.5 mr-1" />
              {running ? 'Läuft…' : 'Regression'}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Tile label="Violations 24h" value={data.violations_24h} icon={AlertTriangle}
                tone={data.violations_24h === 0 ? 'success' : 'warning'} />
          <Tile label="Auto-Repaired" value={data.auto_repaired_24h} icon={Wrench} tone="neutral" />
          <Tile label="Hard-Blocked" value={data.hard_blocked_24h} icon={ShieldAlert}
                tone={data.hard_blocked_24h === 0 ? 'success' : 'destructive'} />
          <Tile label="Unknown Producers" value={data.unknown_producers_24h} icon={UserX}
                tone={data.unknown_producers_24h === 0 ? 'success' : 'warning'} />
        </div>

        {data.top_producers?.length > 0 && (
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <div className="font-medium mb-1">Top-5 Producer mit Violations (24h):</div>
            {data.top_producers.map(p => (
              <div key={p.producer} className="flex justify-between font-mono">
                <span>{p.producer}</span>
                <span>{p.violations}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
