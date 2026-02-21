import { usePipelineTimeline } from '@/hooks/usePipelineTimeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, CheckCircle2, XCircle, AlertTriangle, Timer, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  packageId: string;
  packageTitle?: string;
}

const eventIcons: Record<string, React.ReactNode> = {
  started: <Activity className="h-3.5 w-3.5 text-primary" />,
  progress: <Timer className="h-3.5 w-3.5 text-blue-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  retry_scheduled: <RotateCcw className="h-3.5 w-3.5 text-orange-500" />,
  skipped: <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />,
};

const eventColors: Record<string, string> = {
  started: 'border-primary/30',
  progress: 'border-blue-500/30',
  completed: 'border-emerald-500/30',
  failed: 'border-destructive/30',
  retry_scheduled: 'border-orange-500/30',
  skipped: 'border-muted',
};

export default function PipelineTimeline({ packageId, packageTitle }: Props) {
  const { events, loading } = usePipelineTimeline(packageId);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Pipeline Timeline</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Pipeline Timeline</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Noch keine Pipeline-Events für dieses Paket.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Pipeline Timeline
          {packageTitle && <span className="text-muted-foreground font-normal">– {packageTitle}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-0">
          {/* Timeline line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

          {events.map((ev, i) => (
            <div key={ev.id} className="relative flex items-start gap-3 py-2">
              {/* Dot */}
              <div className={cn(
                "relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background shrink-0",
                eventColors[ev.event_type] || 'border-muted'
              )}>
                {eventIcons[ev.event_type] || <Timer className="h-3.5 w-3.5" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-foreground">{ev.step_key}</span>
                  <Badge
                    variant={ev.event_type === 'failed' ? 'destructive' : 'outline'}
                    className="text-[10px]"
                  >
                    {ev.event_type}
                  </Badge>
                  {ev.progress != null && (
                    <span className="text-[10px] text-muted-foreground">{ev.progress}%</span>
                  )}
                </div>
                {ev.message && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{ev.message}</p>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(ev.created_at).toLocaleString('de-DE', {
                    timeZone: 'Europe/Berlin',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    day: '2-digit', month: '2-digit',
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
