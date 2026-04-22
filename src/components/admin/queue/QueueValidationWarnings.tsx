import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertOctagon, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ValidationWarning {
  id: string;
  package_id: string | null;
  title: string;
  body: string;
  severity: 'high' | 'medium' | 'info' | string;
  job_type: string | null;
  mode: string | null;
  source_job_id: string | null;
  created_at: string;
  is_read: boolean;
}

const SEVERITY_META: Record<string, { cls: string; icon: typeof AlertTriangle; label: string }> = {
  high:   { cls: 'border-destructive/40 bg-destructive/10 text-destructive', icon: AlertOctagon,  label: 'Kritisch' },
  medium: { cls: 'border-warning/40 bg-warning/10 text-warning',             icon: AlertTriangle, label: 'Warnung' },
  info:   { cls: 'border-border bg-muted/30 text-foreground',                icon: AlertTriangle, label: 'Info' },
};

export function QueueValidationWarnings() {
  const warnings = useQuery({
    queryKey: ['queue-validation-warnings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'admin_get_queue_validation_warnings' as any,
        { _limit: 10 }
      );
      if (error) throw error;
      return (data ?? []) as unknown as ValidationWarning[];
    },
    refetchInterval: 30_000,
  });

  const unread = (warnings.data ?? []).filter((w) => !w.is_read);
  if (unread.length === 0) return null;

  const top = unread[0];
  const meta = SEVERITY_META[top.severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;

  return (
    <Card className={cn('border-2', meta.cls)}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Icon className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold">Repair-Validierung</span>
              <Badge variant="outline" className={cn('h-4 px-1.5 text-[9px]', meta.cls)}>
                {meta.label}
              </Badge>
              {unread.length > 1 && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                  +{unread.length - 1} weitere
                </Badge>
              )}
            </div>
            <div className="text-xs font-medium">{top.title}</div>
            <div className="text-[11px] opacity-80 mt-0.5 line-clamp-2">{top.body}</div>
            {(top.job_type || top.mode) && (
              <div className="flex flex-wrap gap-1 mt-1.5 text-[10px] font-mono">
                {top.job_type && (
                  <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/60">
                    job_type: {top.job_type}
                  </span>
                )}
                {top.mode && (
                  <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/60">
                    mode: {top.mode}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
