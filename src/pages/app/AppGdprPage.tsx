import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, Download, Trash2, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAccountSummary } from './hooks/useAccountSummary';

export default function AppGdprPage() {
  const { data, refetch, isLoading } = useAccountSummary();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const pending = data?.pending_gdpr_request;

  const exportData = async () => {
    setBusy('export');
    try {
      const { data: res, error } = await supabase.functions.invoke('gdpr-export-user-data', { body: {} });
      if (error) throw error;
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `examfit-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Export bereit', description: 'Deine Daten wurden heruntergeladen.' });
    } catch (e: any) {
      toast({ title: 'Export fehlgeschlagen', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const requestDeletion = async () => {
    setBusy('request');
    try {
      const { error } = await supabase.rpc('request_gdpr_deletion', { p_reason: reason || null });
      if (error) throw error;
      toast({ title: 'Antrag gestellt', description: 'Du erhältst eine E-Mail zur Bestätigung.' });
      setReason('');
      await refetch();
      qc.invalidateQueries({ queryKey: ['account-summary'] });
    } catch (e: any) {
      toast({ title: 'Fehler', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const cancelDeletion = async () => {
    if (!pending) return;
    setBusy('cancel');
    try {
      const { error } = await supabase.rpc('cancel_gdpr_deletion', { p_request_id: pending.id });
      if (error) throw error;
      toast({ title: 'Antrag abgebrochen' });
      await refetch();
    } catch (e: any) {
      toast({ title: 'Fehler', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><ShieldCheck className="h-6 w-6" /> Datenschutz (DSGVO)</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4" /> Daten exportieren (Art. 15)</CardTitle>
          <CardDescription>Lade alle zu deinem Account gespeicherten Daten als JSON herunter.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={exportData} disabled={busy === 'export'} variant="outline">
            {busy === 'export' && <Loader2 className="h-4 w-4 animate-spin" />}
            Export starten
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Trash2 className="h-4 w-4" /> Löschung beantragen (Art. 17)</CardTitle>
          <CardDescription>30 Tage Frist, jederzeit widerrufbar bis zur Ausführung.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          ) : pending ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="warning">{pending.status}</Badge>
                <span className="text-sm text-text-secondary">
                  Beantragt am {new Date(pending.requested_at).toLocaleDateString('de-DE')}
                </span>
              </div>
              {pending.scheduled_deletion_at && (
                <p className="text-sm text-text-secondary">
                  Geplante Löschung: <strong>{new Date(pending.scheduled_deletion_at).toLocaleDateString('de-DE')}</strong>
                </p>
              )}
              <Button onClick={cancelDeletion} disabled={busy === 'cancel'} variant="outline">
                {busy === 'cancel' && <Loader2 className="h-4 w-4 animate-spin" />}
                Antrag abbrechen
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                placeholder="Optionaler Grund (hilft uns, den Service zu verbessern)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
              <Button onClick={requestDeletion} disabled={busy === 'request'} variant="destructive">
                {busy === 'request' && <Loader2 className="h-4 w-4 animate-spin" />}
                Löschung beantragen
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
