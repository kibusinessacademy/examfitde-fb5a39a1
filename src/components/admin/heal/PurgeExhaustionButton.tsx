/**
 * PurgeExhaustionButton — selektives Bereinigen stale Exhaustion-Marker
 * für ein einzelnes Paket inkl. optionalem Refill (run_integrity_check enqueue).
 *
 * Ruft die SECURITY-DEFINER RPC `admin_purge_stale_exhaustion(uuid, bool)` auf,
 * die ausschließlich Pakete mit drift_class IN STALE_EXHAUSTION_* AND active_jobs=0
 * bereinigt (siehe v_admin_stale_marker_diff).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Sparkles } from 'lucide-react';

interface Props {
  packageId: string;
  packageTitle?: string | null;
  driftClass?: string | null;
  recommendedAction?: string | null;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'default';
  className?: string;
}

export function PurgeExhaustionButton({
  packageId,
  packageTitle,
  driftClass,
  recommendedAction,
  variant = 'outline',
  size = 'sm',
  className,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [triggerRefill, setTriggerRefill] = useState(true);

  const isEligible =
    !driftClass ||
    driftClass.startsWith('STALE_EXHAUSTION') ||
    recommendedAction === 'purge_stale_exhaustion';

  const mut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_purge_stale_exhaustion', {
        p_package_id: packageId,
        p_trigger_refill: triggerRefill,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const purged = data?.markers_purged ?? data?.purged ?? 0;
      const refillEnqueued = data?.refill_enqueued ?? false;
      toast({
        title: 'Exhaustion-Marker bereinigt',
        description: `${purged} Marker entfernt${refillEnqueued ? ' · Refill enqueued' : ''}.`,
      });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['stale-marker-diff'] });
      qc.invalidateQueries({ queryKey: ['package', packageId] });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: 'Bereinigung fehlgeschlagen',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          disabled={!isEligible}
          title={isEligible ? 'Stale Exhaustion-Marker bereinigen' : 'Paket ist nicht stale (active_jobs > 0 oder drift_class != STALE_EXHAUSTION_*)'}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Exhaustion bereinigen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stale Exhaustion-Marker bereinigen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <div>
                Paket: <span className="font-mono text-xs">{packageTitle ?? packageId}</span>
              </div>
              {driftClass && (
                <div>
                  Drift-Class: <span className="font-mono text-xs">{driftClass}</span>
                </div>
              )}
              <div className="text-muted-foreground">
                Diese Aktion löscht <code>HARD_FAIL_REPAIR_EXHAUSTED</code>- und
                <code> terminal_escalation</code>-Marker aus <code>package_steps.meta</code>.
                Sie wirkt nur, wenn aktuell <strong>keine aktiven Jobs</strong> laufen.
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <Checkbox
            id="trigger-refill"
            checked={triggerRefill}
            onCheckedChange={(v) => setTriggerRefill(v === true)}
          />
          <Label htmlFor="trigger-refill" className="text-xs leading-snug cursor-pointer">
            <span className="font-medium">Sofort neu füllen</span>
            <span className="block text-muted-foreground mt-0.5">
              Enqueued <code>run_integrity_check</code> in lane <code>recovery</code>
              nach erfolgreicher Bereinigung (nur wenn Paket „building" + unpublished).
            </span>
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mut.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            disabled={mut.isPending}
          >
            {mut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Bereinigen
            {triggerRefill ? ' & Refill starten' : ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
