import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Activity, CheckCircle2, XCircle, Clock, Loader2, ChevronDown,
  Terminal, Pause, Play, ArrowDownToLine
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface LogEntry {
  id: string;
  timestamp: string;
  step_key: string;
  status: string;
  message: string;
  detail?: string;
  duration_ms?: number;
}

interface BuildLiveLogProps {
  packageId: string;
  isBuilding: boolean;
}

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Lernkurs',
  generate_exam_pool: 'Prüfungsfragen',
  generate_oral_exam: 'Mündliche',
  build_ai_tutor_index: 'AI Tutor',
  generate_handbook: 'Handbuch',
  run_integrity_check: 'Qualitätsprüfung',
  auto_publish: 'Veröffentlichen',
};

function formatLogMessage(step: any): LogEntry {
  const stepLabel = STEP_LABELS[step.step_key] || step.step_key;
  let message = '';
  let detail = '';

  if (step.status === 'running') {
    message = `⏳ ${stepLabel} wird ausgeführt…`;
  } else if (step.status === 'done') {
    message = `✅ ${stepLabel} abgeschlossen`;
    if (step.log) {
      const log = typeof step.log === 'string' ? JSON.parse(step.log) : step.log;
      if (log.target && log.blueprints) {
        detail = `${log.blueprints} Blueprints → Ziel ${log.target} Fragen`;
      } else if (log.lessons_created) {
        detail = `${log.lessons_created} Lektionen erstellt`;
      } else if (log.score !== undefined) {
        detail = `Score: ${log.score}/100 · ${log.issues || 0} Issues · ${log.warnings || 0} Warnungen`;
      } else if (log.scenarios_generated) {
        detail = `${log.scenarios_generated} Szenarien generiert`;
      } else if (log.chapters_generated) {
        detail = `${log.chapters_generated} Kapitel generiert`;
      } else if (log.note) {
        detail = log.note;
      } else {
        // Generic: show key stats
        const keys = Object.keys(log).filter(k => k !== 'ok' && k !== 'note');
        if (keys.length > 0 && keys.length <= 4) {
          detail = keys.map(k => `${k}: ${JSON.stringify(log[k])}`).join(' · ');
        }
      }
    }
  } else if (step.status === 'failed') {
    message = `❌ ${stepLabel} fehlgeschlagen`;
    detail = step.error_message || '';
  } else {
    message = `⏸ ${stepLabel} wartet`;
  }

  return {
    id: step.id || step.step_key,
    timestamp: step.started_at || step.updated_at || step.created_at || new Date().toISOString(),
    step_key: step.step_key,
    status: step.status,
    message,
    detail,
    duration_ms: step.duration_ms,
  };
}

export default function BuildLiveLog({ packageId, isBuilding }: BuildLiveLogProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch build steps and convert to log entries
  const fetchLogs = async () => {
    if (paused) return;
    const { data, error } = await (supabase as any)
      .from('course_package_build_steps')
      .select('*')
      .eq('package_id', packageId)
      .order('started_at', { ascending: true, nullsFirst: false });

    if (!error && data) {
      const entries = data
        .filter((s: any) => s.status !== 'pending' && s.status !== 'queued')
        .map(formatLogMessage);
      setLogs(entries);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [packageId]);

  // Auto-refresh while building
  useEffect(() => {
    if (!isBuilding || paused) return;
    const interval = setInterval(fetchLogs, 4000);
    return () => clearInterval(interval);
  }, [isBuilding, paused, packageId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  if (logs.length === 0 && !isBuilding) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Live Build Log
            {isBuilding && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
            )}
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-muted-foreground cursor-pointer" htmlFor="autoscroll">
                Auto-Scroll
              </label>
              <Switch id="autoscroll" checked={autoScroll} onCheckedChange={setAutoScroll} className="scale-75" />
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPaused(!paused)}>
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
            {!autoScroll && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}>
                <ArrowDownToLine className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[280px] rounded-md border border-border/30 bg-muted/20 p-0" ref={scrollRef}>
          <div className="font-mono text-xs p-3 space-y-1.5">
            {logs.map((entry, i) => (
              <div key={`${entry.id}-${i}`} className={cn(
                "flex gap-2 py-1 px-2 rounded transition-colors",
                entry.status === 'failed' ? 'bg-destructive/5' :
                entry.status === 'running' ? 'bg-primary/5' : ''
              )}>
                <span className="text-muted-foreground shrink-0 w-[52px]">
                  {new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={cn(
                  "flex-1",
                  entry.status === 'failed' ? 'text-destructive' :
                  entry.status === 'done' ? 'text-foreground' :
                  entry.status === 'running' ? 'text-primary' : 'text-muted-foreground'
                )}>
                  {entry.message}
                  {entry.duration_ms && entry.status === 'done' && (
                    <span className="text-muted-foreground ml-1">({(entry.duration_ms / 1000).toFixed(1)}s)</span>
                  )}
                </span>
              </div>
            ))}
            {/* Detail lines */}
            {logs.filter(e => e.detail).map((entry, i) => (
              <div key={`detail-${entry.id}-${i}`} className="flex gap-2 py-0.5 px-2 pl-[68px]">
                <span className="text-muted-foreground text-[10px]">↳ {entry.detail}</span>
              </div>
            ))}
            {isBuilding && !paused && (
              <div className="flex gap-2 py-1 px-2 text-muted-foreground animate-pulse">
                <span className="w-[52px]" />
                <span>Warte auf nächstes Update…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
