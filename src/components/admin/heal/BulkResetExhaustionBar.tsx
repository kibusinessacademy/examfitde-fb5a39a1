/**
 * BulkResetExhaustionBar — Bulk-Heal Bar für RepairExhaustedAlert / StuckPackagesSheet.
 * Erscheint nur wenn ≥1 Paket selektiert ist. Limit 50 Pakete pro Call.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkResetRepairExhaustion } from '@/integrations/supabase/admin-ops-actions';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RotateCcw, X } from 'lucide-react';

interface Props {
  selectedIds: string[];
  onClear: () => void;
}

export function BulkResetExhaustionBar({ selectedIds, onClear }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => bulkResetRepairExhaustion(selectedIds),
    onSuccess: (data: any) => {
      toast({
        title: 'Bulk-Reset abgeschlossen',
        description: `${data?.succeeded ?? 0}/${data?.total ?? selectedIds.length} Pakete reset · ${data?.failed ?? 0} fehlgeschlagen`,
      });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['admin', 'repair-exhausted'] });
      qc.invalidateQueries({ queryKey: ['stuck-packages-detail'] });
      onClear();
    },
    onError: (err: Error) => {
      toast({ title: 'Bulk-Reset fehlgeschlagen', description: err.message, variant: 'destructive' });
    },
  });

  if (selectedIds.length === 0) return null;
  const overLimit = selectedIds.length > 50;

  return (
    <div className="sticky top-0 z-10 rounded-lg border-2 border-primary/40 bg-primary/10 backdrop-blur p-2.5 flex items-center gap-2 shadow-md">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-primary">
          {selectedIds.length} Paket{selectedIds.length > 1 ? 'e' : ''} selektiert
        </div>
        {overLimit && (
          <div className="text-[10px] text-destructive">Max. 50 pro Bulk-Aktion — Auswahl reduzieren.</div>
        )}
      </div>
      <Button
        size="sm"
        variant="default"
        disabled={mut.isPending || overLimit}
        onClick={() => mut.mutate()}
        className="gap-1.5"
      >
        {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Bulk Reset Exhaustion
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} className="h-8 px-2">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
