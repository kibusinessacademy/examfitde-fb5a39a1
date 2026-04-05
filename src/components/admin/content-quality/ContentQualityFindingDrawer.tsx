import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { X, AlertTriangle, CheckCircle2, EyeOff, Wrench } from 'lucide-react';
import type { FindingRow } from '@/pages/admin/v2/ContentQualityPage';
import {
  AdminSheet,
  AdminSheetContent,
  AdminSheetHeader,
  AdminSheetTitle,
  AdminSheetDescription,
} from '@/components/admin/AdminSheet';

interface Props {
  finding: FindingRow | null;
  onClose: () => void;
  onStatusChange: () => void;
}

const severityClass: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  error: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  info: 'bg-muted text-muted-foreground border-border',
};

export function ContentQualityFindingDrawer({ finding, onClose, onStatusChange }: Props) {
  const [ignoreReason, setIgnoreReason] = useState('');
  const [loading, setLoading] = useState(false);

  if (!finding) return null;

  const updateStatus = async (status: string, extra?: Record<string, unknown>) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('content_quality_audit_findings' as any)
        .update({ status, ...extra } as any)
        .eq('id', finding.id);
      if (error) throw error;
      toast.success(`Finding → ${status}`);
      onStatusChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminSheet open={!!finding} onOpenChange={(open) => !open && onClose()}>
      <AdminSheetContent className="w-full sm:max-w-lg">
        <AdminSheetHeader>
          <AdminSheetTitle className="flex items-center gap-2 text-base">
            <Badge variant="outline" className={cn('text-[10px] font-mono', severityClass[finding.severity])}>
              {finding.severity.toUpperCase()}
            </Badge>
            <span className="truncate">{finding.title || finding.artifact_id.slice(0, 12)}</span>
          </AdminSheetTitle>
          <AdminSheetDescription className="text-xs">
            {finding.artifact_type} · {finding.artifact_id.slice(0, 8)}
          </AdminSheetDescription>
        </AdminSheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          {/* Metrics */}
          <div className="grid grid-cols-3 gap-2">
            <MetricCard label="Generic Phrases" value={finding.generic_phrase_count} />
            <MetricCard label="Spelling Errors" value={finding.spelling_error_count} />
            <MetricCard label="Generic Ratio" value={`${(finding.generic_ratio * 100).toFixed(1)}%`} />
          </div>

          {/* Generic phrases */}
          {finding.generic_phrases.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Generische Phrasen</div>
              <div className="flex flex-wrap gap-1.5">
                {finding.generic_phrases.map((p, i) => (
                  <span key={i} className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">
                    „{p}"
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Spelling errors */}
          {finding.spelling_errors.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Rechtschreibfehler</div>
              <div className="flex flex-wrap gap-1.5">
                {finding.spelling_errors.map((e, i) => (
                  <span key={i} className="text-[10px] bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded-full border border-rose-500/20">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Excerpt */}
          {finding.excerpt && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Auszug</div>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 leading-relaxed max-h-40 overflow-y-auto">
                {finding.excerpt}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-2 border-t border-border">
            {finding.auto_reheal_eligible && (
              <Button
                size="sm"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => updateStatus('rehealing')}
              >
                <Wrench className="h-3.5 w-3.5" />
                Reheal starten
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              disabled={loading}
              onClick={() => updateStatus('resolved', { resolved_at: new Date().toISOString() })}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Als gelöst markieren
            </Button>

            <div className="flex gap-2">
              <Input
                placeholder="Grund für Ignore…"
                value={ignoreReason}
                onChange={e => setIgnoreReason(e.target.value)}
                className="h-8 text-xs flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || !ignoreReason.trim()}
                onClick={() => updateStatus('ignored', { ignored_reason: ignoreReason })}
                className="gap-1.5 shrink-0"
              >
                <EyeOff className="h-3.5 w-3.5" />
                Ignorieren
              </Button>
            </div>
          </div>
        </div>
      </AdminSheetContent>
    </AdminSheet>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}
