import { useRealtimeAlerts } from '@/hooks/useAdminRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertTriangle, Bell, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RealtimeAlerts() {
  const { alerts, loading, acknowledge } = useRealtimeAlerts();

  const handleAck = async (id: string) => {
    await acknowledge(id);
    toast.success('Alert bestätigt');
  };

  const handleAckAll = async () => {
    for (const a of alerts) {
      await acknowledge(a.id);
    }
    toast.success(`${alerts.length} Alerts bestätigt`);
  };

  if (loading) return null;
  if (alerts.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-destructive">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4 text-destructive" />
            Live Alerts ({alerts.length})
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={handleAckAll}>
            <Check className="h-3 w-3 mr-1" /> Alle bestätigen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {alerts.map(a => (
            <div
              key={a.id}
              className={cn(
                "flex items-start justify-between gap-2 text-xs p-2 rounded-lg",
                a.severity === 'error' ? 'bg-destructive/5' : 'bg-muted/30'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={a.severity === 'error' ? 'destructive' : 'secondary'}
                    className="text-[9px]"
                  >
                    {a.severity}
                  </Badge>
                  <span className="text-muted-foreground font-mono">{a.source}</span>
                  <span className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <p className="mt-1 text-foreground truncate">{a.message}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => handleAck(a.id)}
              >
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
