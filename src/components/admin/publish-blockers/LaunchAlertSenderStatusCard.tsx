/**
 * LaunchAlertSenderStatusCard
 * ----------------------------
 * Shows the current Resend sender configuration for 48h Launch Alerts:
 *   - Configured FROM address (alerts@berufos.com)
 *   - Domain verified flag (true/false)
 *   - Effective sender = verified ? configured : fallback (onboarding@resend.dev)
 *   - Recipients (admin_settings.launch_alert_recipients)
 *   - Last 5 outbox entries (sent vs pending vs error)
 *
 * Source: public.admin_settings + public.launch_alert_email_outbox (admin RLS).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertTriangle, Mail, Clock, XCircle, ShieldCheck, Loader2 } from 'lucide-react';

type FromSetting = {
  email?: string;
  name?: string;
  fallback?: string;
  verified?: boolean;
  updated_at?: string;
};

type RecipientsSetting = {
  emails?: string[];
  updated_at?: string;
};

type OutboxRow = {
  id: string;
  alert_key: string;
  severity: string;
  created_at: string;
  sent_at: string | null;
  send_error: string | null;
};

export default function LaunchAlertSenderStatusCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const settings = useQuery({
    queryKey: ['admin-launch-alert-sender-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('key,value,updated_at')
        .in('key', ['launch_alert_from_address', 'launch_alert_recipients']);
      if (error) throw error;
      const map = new Map<string, any>();
      (data ?? []).forEach((r: any) => map.set(r.key, r.value));
      return {
        from: (map.get('launch_alert_from_address') ?? {}) as FromSetting,
        recipients: (map.get('launch_alert_recipients') ?? {}) as RecipientsSetting,
      };
    },
    refetchInterval: 60_000,
  });

  const outbox = useQuery({
    queryKey: ['admin-launch-alert-outbox-recent'],
    queryFn: async (): Promise<OutboxRow[]> => {
      const { data, error } = await supabase
        .from('launch_alert_email_outbox' as any)
        .select('id,alert_key,severity,created_at,sent_at,send_error')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as OutboxRow[];
    },
    refetchInterval: 60_000,
  });

  const from = settings.data?.from ?? {};
  const verified = from.verified === true;
  const configuredEmail = from.email ?? '—';
  const fallbackEmail = from.fallback ?? 'onboarding@resend.dev';
  const effectiveEmail = verified && from.email ? from.email : fallbackEmail;
  const senderName = from.name ?? 'ExamFit Alerts';
  const recipients = settings.data?.recipients?.emails ?? [];

  const verifyMut = useMutation({
    mutationFn: async (input: { note: string }) => {
      const { data, error } = await supabase.rpc(
        'admin_mark_sender_verified_and_smoke' as any,
        { p_verified: true, p_note: input.note || null } as any,
      );
      if (error) throw error;
      return data as { ok: boolean; outbox_id: string; alert_key: string };
    },
    onSuccess: async (data) => {
      toast({
        title: 'Domain als verified markiert',
        description: `Smoke-Alert in der Outbox: ${data.alert_key}. Flush wird sofort ausgelöst.`,
      });
      // Trigger immediate flush so user does not wait 5 min for cron
      try {
        await supabase.functions.invoke('launch-alert-email-flush');
      } catch (e) {
        // Non-fatal: cron will pick it up
        console.warn('immediate flush failed; cron will retry', e);
      }
      setConfirmOpen(false);
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin-launch-alert-sender-settings'] });
      qc.invalidateQueries({ queryKey: ['admin-launch-alert-outbox-recent'] });
    },
    onError: (e: any) => {
      toast({
        title: 'Aktion fehlgeschlagen',
        description: String(e?.message ?? e),
        variant: 'destructive',
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Launch-Alert Sender (Resend)
          {settings.isLoading ? null : verified ? (
            <Badge variant="default" className="ml-2 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Domain verified
            </Badge>
          ) : (
            <Badge variant="destructive" className="ml-2 gap-1">
              <AlertTriangle className="h-3 w-3" /> DNS pending – Fallback aktiv
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Status der FROM-Adresse für 48h-Soft-Launch-E-Mail-Alerts. Solange die Domain
          berufos.com in Resend nicht grün ist, wird automatisch der Test-Absender genutzt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-1 p-3">
          <div className="text-xs text-text-secondary">
            Wenn die Domain in Resend grün ist: hier <span className="font-medium">verified=true</span> setzen.
            Es wird sofort ein Smoke-Alert in die Outbox gelegt und der Flush-Worker manuell getriggert.
          </div>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant={verified ? 'outline' : 'default'} className="gap-1">
                <ShieldCheck className="h-4 w-4" />
                {verified ? 'Smoke-Alert erneut senden' : 'Verified=true setzen + Smoke senden'}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Sender als verified markieren</DialogTitle>
                <DialogDescription>
                  Setzt <span className="font-mono">launch_alert_from_address.verified = true</span>.
                  Ab sofort wird <span className="font-mono">{configuredEmail}</span> als FROM verwendet
                  (statt {fallbackEmail}). Anschließend wird ein Smoke-Alert (severity=info) in die
                  Outbox gelegt und der Flush-Worker direkt aufgerufen.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary">Audit-Notiz (optional)</label>
                <textarea
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  rows={2}
                  placeholder="z.B. SPF+DKIM in Resend grün, getestet 2026-05-06 14:00 UTC"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={verifyMut.isPending}>
                  Abbrechen
                </Button>
                <Button
                  onClick={() => verifyMut.mutate({ note })}
                  disabled={verifyMut.isPending}
                  className="gap-1"
                >
                  {verifyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Bestätigen & Smoke auslösen
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs text-text-tertiary mb-1">Konfigurierter Absender</div>
            <div className="font-mono text-sm break-all">{senderName} &lt;{configuredEmail}&gt;</div>
            <div className="mt-2">
              {verified ? (
                <Badge variant="default" className="text-[10px]">verified=true</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">verified=false</Badge>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs text-text-tertiary mb-1">Fallback-Absender</div>
            <div className="font-mono text-sm break-all">{fallbackEmail}</div>
            <div className="mt-2">
              <Badge variant="secondary" className="text-[10px]">
                {verified ? 'inaktiv' : 'aktiv (in Verwendung)'}
              </Badge>
            </div>
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs text-text-tertiary mb-1">Effektiver FROM (live)</div>
            <div className="font-mono text-sm break-all">{senderName} &lt;{effectiveEmail}&gt;</div>
            <div className="mt-2">
              <Badge
                variant={verified ? 'default' : 'destructive'}
                className="text-[10px]"
              >
                {verified ? 'eigene Domain' : 'Resend Test-Domain'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
          <div className="text-xs text-text-tertiary mb-2">Empfänger ({recipients.length})</div>
          <div className="flex flex-wrap gap-2">
            {recipients.length === 0 ? (
              <span className="text-sm text-text-secondary">Keine Empfänger konfiguriert</span>
            ) : (
              recipients.map((e) => (
                <Badge key={e} variant="outline" className="font-mono text-[11px]">{e}</Badge>
              ))
            )}
          </div>
        </div>

        {!verified && (
          <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg-subtle p-3 text-warning">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <div className="font-medium mb-1">DNS-Verifizierung ausstehend</div>
              berufos.com ist in Resend noch nicht grün. Alerts werden derzeit über den
              Test-Absender <span className="font-mono">{fallbackEmail}</span> ausgeliefert.
              Sobald die Domain verifiziert ist, wird automatisch auf{' '}
              <span className="font-mono">{configuredEmail}</span> umgeschaltet.
            </div>
          </div>
        )}

        <div>
          <div className="text-xs text-text-tertiary mb-2">Letzte 5 Outbox-Einträge</div>
          {outbox.isLoading ? (
            <div className="text-sm text-text-secondary">Lade…</div>
          ) : (outbox.data ?? []).length === 0 ? (
            <div className="text-sm text-text-secondary">Keine Alerts in der Outbox</div>
          ) : (
            <div className="space-y-1">
              {(outbox.data ?? []).map((r) => {
                const state = r.sent_at
                  ? { label: 'sent', variant: 'default' as const, Icon: CheckCircle2 }
                  : r.send_error
                    ? { label: 'error', variant: 'destructive' as const, Icon: XCircle }
                    : { label: 'pending', variant: 'secondary' as const, Icon: Clock };
                const { Icon } = state;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-surface-1 px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={state.variant} className="gap-1 text-[10px]">
                        <Icon className="h-3 w-3" />
                        {state.label}
                      </Badge>
                      <span className="font-mono truncate">{r.alert_key}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{r.severity}</Badge>
                    </div>
                    <span className="text-text-tertiary shrink-0">
                      {new Date(r.created_at).toLocaleString('de-DE')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
