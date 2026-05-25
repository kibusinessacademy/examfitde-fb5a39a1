import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Mail, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const EMAIL_TYPES = [
  { id: 'signup', label: 'Signup (Confirm)' },
  { id: 'magiclink', label: 'Magic Link' },
  { id: 'recovery', label: 'Password Recovery' },
  { id: 'invite', label: 'Invite' },
  { id: 'reauthentication', label: 'Reauthentication (Info only)' },
] as const;

type Result = { ok: boolean; skipped?: boolean; note: string; duration_ms: number };

export default function AuthEmailSmokeTestPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<string[]>(EMAIL_TYPES.map((t) => t.id));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, Result> | null>(null);
  const [runAt, setRunAt] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = async () => {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast({ title: 'Bitte gültige E-Mail eingeben', variant: 'destructive' });
      return;
    }
    setLoading(true);
    setResults(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-auth-email-smoke-test', {
        body: { email, types: selected },
      });
      if (error) throw error;
      setResults(data.results);
      setRunAt(data.at);
      toast({ title: 'Smoke-Test abgeschlossen', description: `Ziel: ${email}` });
    } catch (e) {
      toast({
        title: 'Fehler',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const icon = (r: Result) =>
    r.ok ? (
      <CheckCircle2 className="h-5 w-5 text-status-success-fg" />
    ) : r.skipped ? (
      <AlertCircle className="h-5 w-5 text-status-warning-fg" />
    ) : (
      <XCircle className="h-5 w-5 text-status-error-fg" />
    );

  return (
    <div className="container mx-auto py-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Mail className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Auth-Email Smoke-Test</h1>
          <p className="text-sm text-muted-foreground">
            Testet Signup / Magic-Link / Recovery / Invite / Reauth gegen eine Testadresse.
            Versand läuft über <code>auth-email-hook</code> → <code>notify.berufos.com</code>.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Konfiguration</CardTitle>
          <CardDescription>
            Wähle die Test-Empfängeradresse (am besten Inbox mit DKIM/Spam-Check) und die Email-Typen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Test-Empfänger</Label>
            <Input
              id="email"
              type="email"
              placeholder="test@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label>Email-Typen</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EMAIL_TYPES.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selected.includes(t.id)}
                    onCheckedChange={() => toggle(t.id)}
                    disabled={loading}
                  />
                  <span className="text-sm text-foreground">{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={run} disabled={loading || !email} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Versende…
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Test ausführen
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {results && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Ergebnisse</CardTitle>
            <CardDescription>
              {runAt && <>Ausgeführt: {new Date(runAt).toLocaleString('de-DE')} · </>}
              Empfänger: <strong>{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(results).map(([type, r]) => (
              <div
                key={type}
                className="flex items-start gap-3 p-3 rounded-md border border-border"
              >
                {icon(r)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{type}</span>
                    <span className="text-xs text-muted-foreground">{r.duration_ms} ms</span>
                  </div>
                  <p className="text-sm text-muted-foreground break-words">{r.note}</p>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-4">
              Audit: Jeder Lauf wird in <code>auto_heal_log</code> (action_type=
              <code>auth_email_smoke_test</code>) protokolliert. Reauthentication kann nur aus einer
              eingeloggten Session ausgelöst werden (Supabase-Constraint) — bitte separat im UI testen.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
