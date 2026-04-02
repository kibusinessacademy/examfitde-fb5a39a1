import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Activity, CheckCircle2, XCircle, Clock, Loader2,
  Terminal, Pause, Play
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

// Step labels from SSOT
import { PIPELINE_STEP_LABELS, getStepLabel } from '@/lib/pipeline-steps';
const STEP_LABELS = PIPELINE_STEP_LABELS as Record<string, string>;

function formatLogMessage(step: any): LogEntry {
  const stepLabel = STEP_LABELS[step.step_key] || step.step_key;
  let message = '';
  let detail = '';
  // package_steps uses 'meta' instead of 'log', and 'last_error' instead of 'error_message'
  const log = step.meta || step.log;
  const errorMessage = step.last_error || step.error_message;

  // Keys that are internal metadata, not user-visible log info
  const META_NOISE_KEYS = new Set([
    'reset_reason', 'status_healed_at', 'status_lag_healed_at', 'last_progress_note',
    'previous_errors', 'needs_regen', 'active_lesson_jobs', 'dispatch_blocked_reason',
    'batch_complete', 'ok', 'note', 'reset_count', 'healed_count',
  ]);

  if (step.status === 'running') {
    message = `⏳ ${stepLabel} wird ausgeführt…`;
  } else if (step.status === 'done') {
    message = `✅ ${stepLabel} abgeschlossen`;
    if (log) {
      try {
        const parsed = typeof log === 'string' ? JSON.parse(log) : log;
        if (parsed.target && parsed.blueprints) {
          detail = `${parsed.blueprints} Blueprints → Ziel ${parsed.target} Fragen`;
        } else if (parsed.lessons_created) {
          detail = `${parsed.lessons_created} Lektionen erstellt`;
        } else if (parsed.score !== undefined) {
          detail = `Score: ${parsed.score}/100 · ${parsed.issues || 0} Issues · ${parsed.warnings || 0} Warnungen`;
        } else if (parsed.scenarios_generated) {
          detail = `${parsed.scenarios_generated} Szenarien generiert`;
        } else if (parsed.chapters_generated) {
          detail = `${parsed.chapters_generated} Kapitel generiert`;
        } else if (parsed.note) {
          detail = parsed.note;
        } else {
          const keys = Object.keys(parsed).filter(k => !META_NOISE_KEYS.has(k));
          if (keys.length > 0 && keys.length <= 4) {
            detail = keys.map(k => `${k}: ${JSON.stringify(parsed[k])}`).join(' · ');
          }
        }
      } catch { /* ignore parse errors */ }
    }
  } else if (step.status === 'failed') {
    message = `❌ ${stepLabel} fehlgeschlagen`;
    detail = errorMessage || '';
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
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch build steps and convert to log entries
  const fetchLogs = async () => {
    if (paused) return;
    const { data, error } = await (supabase as any)
      .from('package_steps')
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
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPaused(!paused)}>
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[180px] sm:h-[280px] rounded-md border border-border/30 bg-muted/20 p-0" ref={scrollRef}>
          <div className="font-mono text-xs p-3 space-y-1.5">
            {logs.map((entry, i) => (
              <div key={`${entry.id}-${i}`}>
                <div className={cn(
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
                {entry.detail && (
                  <div className="flex gap-2 py-0.5 px-2 pl-[68px]">
                    <span className="text-muted-foreground text-[10px]">↳ {entry.detail}</span>
                  </div>
                )}
              </div>
            ))}
            {isBuilding && !paused && (
              <div className="flex gap-2 py-1 px-2 text-muted-foreground animate-pulse">
                <span className="w-[52px]" />
                <span>Warte auf nächstes Update…</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}