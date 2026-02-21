import { AlertTriangle } from 'lucide-react';
import { useRealtimeAlerts } from '@/hooks/useAdminRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function OpsAlertsWidget() {
  const { alerts, loading, acknowledge } = useRealtimeAlerts(20);

  if (loading || alerts.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-destructive">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Pipeline Alerts ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {alerts.map(a => (
            <div key={a.id} className="flex items-start justify-between gap-2 text-xs p-2 rounded bg-muted/30">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={a.severity === 'error' ? 'destructive' : 'secondary'} className="text-[9px]">
                    {a.severity}
                  </Badge>
                  <span className="text-muted-foreground">{a.source}</span>
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleTimeString('de-DE')}</span>
                </div>
                <p className="mt-1 text-foreground truncate">{a.message}</p>
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] shrink-0" onClick={() => acknowledge(a.id)}>
                ✓
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
