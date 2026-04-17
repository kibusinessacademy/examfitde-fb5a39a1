/**
 * RepairToolboxActions — wiederverwendbare Heal-Toolbox v8.
 *
 * Bietet die universellen Schwerlast-Aktionen für festgefahrene Pakete:
 *   • Reset Exhaustion-Counter (markiert Paket als Repair, requeued failed Jobs mit Prio 5)
 *   • Mark content_gap (Paket auf blocked, klare Begründung)
 *   • Hard Depublish & Rebuild (Paket zurücksetzen + neu starten)
 *
 * Repair-Pakete erhalten automatisch WIP-Bonus-Slots (Trigger-gesteuert).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  resetRepairExhaustion,
  markContentGap,
  hardDepublishAndRebuild,
} from '@/integrations/supabase/admin-ops-actions';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { RotateCcw, OctagonAlert, Hammer, Loader2 } from 'lucide-react';

interface Props {
  packageId: string;
  packageTitle?: string;
  /** Hide hard rebuild button (nicht jeder Kontext erlaubt das) */
  hideHardRebuild?: boolean;
  size?: 'sm' | 'default';
  variant?: 'inline' | 'stacked';
}

export function RepairToolboxActions({
  packageId,
  packageTitle,
  hideHardRebuild = false,
  size = 'sm',
  variant = 'inline',
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [contentGapReason, setContentGapReason] = useState('');
  const [rebuildReason, setRebuildReason] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: ['stuck-packages-detail'] });
    qc.invalidateQueries({ queryKey: ['admin', 'repair-exhausted'] });
  };

  const handleError = (action: string) => (err: Error) => {
    const msg = err.message || 'Unbekannter Fehler';
    if (msg.includes('WIP_CAP_EXCEEDED_REPAIR')) {
      toast({
        title: 'Repair WIP voll',
        description: 'Auch die Bonus-Slots sind belegt — warte einen Moment und versuche es erneut.',
        variant: 'destructive',
      });
    } else if (msg.includes('WIP_CAP_EXCEEDED')) {
      toast({
        title: 'WIP-Limit erreicht',
        description: 'Markiere das Paket erst als Repair, damit Bonus-Slots greifen.',
        variant: 'destructive',
      });
    } else {
      toast({ title: `${action} fehlgeschlagen`, description: msg, variant: 'destructive' });
    }
  };

  const resetMut = useMutation({
    mutationFn: () => resetRepairExhaustion(packageId),
    onSuccess: (data: any) => {
      toast({
        title: 'Exhaustion zurückgesetzt',
        description: `${data?.steps_reset ?? 0} Steps · ${data?.jobs_reset ?? 0} Jobs requeued (mit Bonus-Slot).`,
      });
      invalidate();
    },
    onError: handleError('Reset Exhaustion'),
  });

  const gapMut = useMutation({
    mutationFn: (reason: string) => markContentGap(packageId, reason),
    onSuccess: () => {
      toast({ title: 'content_gap markiert', description: 'Paket auf blockiert gesetzt, Jobs gecancelt.' });
      setContentGapReason('');
      invalidate();
    },
    onError: handleError('Mark content_gap'),
  });

  const rebuildMut = useMutation({
    mutationFn: (reason: string) => hardDepublishAndRebuild(packageId, reason),
    onSuccess: () => {
      toast({ title: 'Hard Rebuild gestartet', description: 'Paket entpubliziert und Build neu angestoßen (Repair-Modus aktiv).' });
      setRebuildReason('');
      invalidate();
    },
    onError: handleError('Hard Rebuild'),
  });

  const busy = resetMut.isPending || gapMut.isPending || rebuildMut.isPending;
  const wrapperCls = variant === 'inline' ? 'flex flex-wrap gap-1.5' : 'grid gap-1.5';

  return (
    <div className={wrapperCls}>
      <Button
        size={size}
        variant="default"
        disabled={busy}
        onClick={() => resetMut.mutate()}
        className="gap-1.5"
        title="Setzt Versuchszähler zurück, requeued failed Jobs und gewährt Bonus-WIP-Slot"
      >
        {resetMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Reset Exhaustion
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size={size}
            variant="outline"
            disabled={busy}
            className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            {gapMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <OctagonAlert className="h-3.5 w-3.5" />}
            content_gap
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>content_gap markieren</AlertDialogTitle>
            <AlertDialogDescription>
              Setzt {packageTitle ? `„${packageTitle}"` : 'das Paket'} auf <strong>blocked</strong> und cancelt alle pending Jobs.
              Verwende dies, wenn das Curriculum zu wenig Inhalt für die geforderte Coverage liefert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="gap-reason">Begründung (für Audit-Log)</Label>
            <Textarea
              id="gap-reason"
              placeholder="z. B. Coverage 50 % < 85 % — nur 28/56 Kompetenzen abgedeckt"
              value={contentGapReason}
              onChange={(e) => setContentGapReason(e.target.value)}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => gapMut.mutate(contentGapReason || 'curriculum coverage insufficient')}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Auf blocked setzen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!hideHardRebuild && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size={size}
              variant="outline"
              disabled={busy}
              className="gap-1.5 border-warning/30 text-warning hover:bg-warning/10"
            >
              {rebuildMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hammer className="h-3.5 w-3.5" />}
              Hard Rebuild
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hard Depublish & Rebuild</AlertDialogTitle>
              <AlertDialogDescription>
                Entpubliziert {packageTitle ? `„${packageTitle}"` : 'das Paket'}, setzt alle Build-Steps zurück und startet die Pipeline neu.
                Das Paket wird automatisch als Repair markiert und nutzt WIP-Bonus-Slots. <strong>Lernfortschritt der Nutzer bleibt erhalten</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="rebuild-reason">Begründung (Pflicht)</Label>
              <Textarea
                id="rebuild-reason"
                placeholder="z. B. Hollow-Publish trotz Pool-Defizit erkannt — Vollreparatur"
                value={rebuildReason}
                onChange={(e) => setRebuildReason(e.target.value)}
                rows={3}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                disabled={!rebuildReason.trim()}
                onClick={() => rebuildMut.mutate(rebuildReason)}
                className="bg-warning text-warning-foreground hover:bg-warning/90"
              >
                Rebuild starten
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
