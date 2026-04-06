import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, DollarSign, Clock } from 'lucide-react';

export default function ThroughputCard() {
  const { data } = useQuery({
    queryKey: ['admin', 'throughput-cost'],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [completedRes, costRes] = await Promise.all([
        supabase.from('job_queue')
          .select('id', { head: true, count: 'exact' })
          .eq('status', 'completed')
          .gte('completed_at', todayStart.toISOString()),
        (supabase as any).rpc('get_ai_cost_summary'),
      ]);

      const completedToday = completedRes.count ?? 0;
      const hourNow = Math.max(new Date().getHours(), 1);
      const costData = costRes.data ?? { cost_today: 0, cost_mtd: 0 };

      return {
        completedToday,
        throughputPerHour: Math.round(completedToday / hourNow * 10) / 10,
        costToday: Number(costData.cost_today) || 0,
        costMtd: Number(costData.cost_mtd) || 0,
      };
    },
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const fmtEur = (v: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card className="border-border bg-card">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            <TrendingUp className="h-3 w-3" /> Durchsatz
          </div>
          <div className="text-xl font-bold text-foreground">{data.completedToday}</div>
          <div className="text-[10px] text-muted-foreground">Jobs heute</div>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            <Clock className="h-3 w-3" /> Rate
          </div>
          <div className="text-xl font-bold text-foreground">{data.throughputPerHour}</div>
          <div className="text-[10px] text-muted-foreground">Jobs/Stunde</div>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            <DollarSign className="h-3 w-3" /> KI heute
          </div>
          <div className="text-xl font-bold text-foreground">{fmtEur(data.costToday)}</div>
          <div className="text-[10px] text-muted-foreground">Kosten heute</div>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            <DollarSign className="h-3 w-3" /> KI MTD
          </div>
          <div className="text-xl font-bold text-foreground">{fmtEur(data.costMtd)}</div>
          <div className="text-[10px] text-muted-foreground">Kosten Monat</div>
        </CardContent>
      </Card>
    </div>
  );
}
