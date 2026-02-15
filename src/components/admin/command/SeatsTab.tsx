import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

type SeatRow = {
  license_package_id: string | null;
  buyer_user_id: string | null;
  company_id: string | null;
  product_id: string | null;
  seats_total: number | null;
  seats_used: number | null;
  seats_free: number | null;
  utilization_pct: number | null;
  first_seat_assigned: string | null;
  last_seat_assigned: string | null;
};

export default function SeatsTab() {
  const [rows, setRows] = useState<SeatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('corporate_seat_utilization')
        .select('*')
        .order('utilization_pct', { ascending: true, nullsFirst: false })
        .limit(100);

      if (!mounted) return;
      if (err) setError(err.message);
      setRows((data as SeatRow[]) ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const totalSeats = rows.reduce((s, r) => s + (r.seats_total ?? 0), 0);
  const totalUsed = rows.reduce((s, r) => s + (r.seats_used ?? 0), 0);
  const avgUtil = totalSeats > 0 ? (totalUsed / totalSeats) * 100 : 0;

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return <Card className="p-4"><p className="text-sm text-destructive">{error}</p></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Gesamt Seats</p>
            <p className="text-lg font-bold text-foreground">{totalSeats}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Belegt</p>
            <p className="text-lg font-bold text-foreground">{totalUsed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Ø Auslastung</p>
            <p className="text-lg font-bold text-foreground">{avgUtil.toFixed(0)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Corporate Seat-Auslastung
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">Keine Corporate-Lizenzen vorhanden</p>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => {
                const util = r.utilization_pct ?? 0;
                return (
                  <div key={r.license_package_id ?? r.company_id} className="p-3 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs truncate max-w-[120px]" title={r.company_id ?? ''}>
                          {r.company_id?.slice(0, 8) ?? r.license_package_id?.slice(0, 8) ?? '—'}…
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {r.seats_used ?? 0} / {r.seats_total ?? 0}
                        </Badge>
                      </div>
                      <span className={`text-xs font-medium ${util >= 80 ? 'text-primary' : util >= 50 ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {util.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={util} className="h-1.5" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
