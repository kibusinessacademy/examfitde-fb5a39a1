/**
 * RepairToolboxActions v9 — SSOT Heal-Toolbox
 * ───────────────────────────────────────────
 * Drei klar getrennte Aktionen:
 *   1. Soft Reentry      → reset_to_step (kein Job-Cancel, gewählter Step)
 *   2. Hard Heal         → admin_manual_heal_package (Cancel + Reset + Clear blocked)
 *   3. content_gap       → markiert Paket als unrettbar (separater Pfad)
 *   4. Hard Rebuild      → vollständiger Depublish + Rebuild (existierender Pfad)
 *
 * Alle Pfade gehen über usePackageHealAction → runPackageHealAction.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  markContentGap,
  hardDepublishAndRebuild,
} from '@/integrations/supabase/admin-ops-actions';
import { usePackageHealAction } from '@/lib/admin/heal/usePackageHealAction';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { OctagonAlert, Hammer, Loader2, Wrench, RotateCcw } from 'lucide-react';

interface Props {
  packageId: string;
  packageTitle?: string;
  hideHardRebuild?: boolean;
  size?: 'sm' | 'default';
  variant?: 'inline' | 'stacked';
}

const HEAL_STEPS: Array<{ value: string; label: string }> = [
  { value: 'scaffold_learning_course', label: 'Lessons (scaffold_learning_course)' },
  { value: 'fanout_learning_content', label: 'Lesson Content (fanout_learning_content)' },
  { value: 'generate_handbook', label: 'Handbuch (generate_handbook)' },
  { value: 'generate_exam_pool', label: 'Exam Pool (generate_exam_pool)' },
  { value: 'repair_exam_pool_quality', label: 'Pool Quality Repair (repair_exam_pool_quality)' },
  { value: 'generate_oral_exam', label: 'Oral Exam (generate_oral_exam)' },
  { value: 'run_integrity_check', label: 'Integrity (run_integrity_check)' },
  { value: 'auto_publish', label: 'Publish (auto_publish)' },
];

export function RepairToolboxActions({
  packageId,
  packageTitle,
  hideHardRebuild = false,
  size = 'sm',
  variant = 'inline',
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const heal = usePackageHealAction();

  const [softStep, setSoftStep] = useState('run_integrity_check');
  const [hardStep, setHardStep] = useState('generate_exam_pool');
  const [hardReason, setHardReason] = useState('');
  const [contentGapReason, setContentGapReason] = useState('');
  const [rebuildReason, setRebuildReason] = useState('');

  const gapMut = useMutation({
    mutationFn: (reason: string) => markContentGap(packageId, reason),
    onSuccess: () => {
      toast({ title: 'content_gap markiert', description: 'Paket auf blockiert gesetzt, Jobs gecancelt.' });
      setContentGapReason('');
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) =>
      toast({ title: 'Mark content_gap fehlgeschlagen', description: err.message, variant: 'destructive' }),
  });

  const rebuildMut = useMutation({
    mutationFn: (reason: string) => hardDepublishAndRebuild(packageId, reason),
    onSuccess: () => {
      toast({ title: 'Hard Rebuild gestartet', description: 'Depublish + neuer Build (Repair-Modus).' });
      setRebuildReason('');
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) =>
      toast({ title: 'Hard Rebuild fehlgeschlagen', description: err.message, variant: 'destructive' }),
  });

  const busy = heal.isPending || gapMut.isPending || rebuildMut.isPending;
  const wrapperCls = variant === 'inline' ? 'flex flex-wrap gap-1.5' : 'grid gap-1.5';

  return (
    <div className={wrapperCls}>
      {/* SOFT REENTRY */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size={size}
            variant="outline"
            disabled={busy}
            className="gap-1.5"
            title="Soft Reentry: reset_to_step ohne Job-Cancel"
          >
            {heal.isPending && heal.variables?.mode === 'soft'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RotateCcw className="h-3.5 w-3.5" />}
            Soft Reentry
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Soft Reentry</AlertDialogTitle>
            <AlertDialogDescription>
              Setzt {packageTitle ? `„${packageTitle}"` : 'das Paket'} auf den gewählten Step zurück
              <strong> ohne </strong>aktive Jobs zu canceln. Verwende dies, wenn die Pipeline nur „nachläuft" und kein Loop vorliegt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Step</Label>
            <Select value={softStep} onValueChange={setSoftStep}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEAL_STEPS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                heal.mutate({
                  packageId,
                  mode: 'soft',
                  resetFromStep: softStep,
                  reason: `manual_soft_reentry:${softStep}`,
                })
              }
            >
              Soft Reentry starten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* HARD HEAL */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size={size}
            variant="default"
            disabled={busy}
            className="gap-1.5"
            title="Hard Heal: cancelt Jobs, resettet Step, clearet blocked_reason"
          >
            {heal.isPending && heal.variables?.mode === 'hard'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Wrench className="h-3.5 w-3.5" />}
            Hard Heal
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hard Heal (admin_manual_heal_package)</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelt aktive Jobs, setzt {packageTitle ? `„${packageTitle}"` : 'das Paket'} ab dem gewählten Step zurück
              und cleared <code>blocked_reason</code>. SSOT-Bypass für Loop-Tote &amp; queued-without-job.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reset ab Step</Label>
              <Select value={hardStep} onValueChange={setHardStep}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HEAL_STEPS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Begründung (Pflicht)</Label>
              <Textarea
                placeholder="z. B. REPAIR_NO_EFFECT loop, queued_without_job"
                value={hardReason}
                onChange={(e) => setHardReason(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={!hardReason.trim()}
              onClick={() => {
                heal.mutate({
                  packageId,
                  mode: 'hard',
                  resetFromStep: hardStep,
                  reason: hardReason || 'manual_hard_heal',
                  cancelActiveJobs: true,
                });
                setHardReason('');
              }}
            >
              Hard Heal ausführen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CONTENT GAP */}
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
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Begründung</Label>
            <Textarea
              placeholder="z. B. Coverage 50 % &lt; 85 % — nur 28/56 Kompetenzen abgedeckt"
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

      {/* HARD REBUILD (legacy, existing path) */}
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
              <AlertDialogTitle>Hard Depublish &amp; Rebuild</AlertDialogTitle>
              <AlertDialogDescription>
                Entpubliziert {packageTitle ? `„${packageTitle}"` : 'das Paket'}, setzt alle Build-Steps zurück und startet die Pipeline neu.
                Repair-Modus aktiv, <strong>Lernfortschritt der Nutzer bleibt erhalten</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label>Begründung (Pflicht)</Label>
              <Textarea
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
