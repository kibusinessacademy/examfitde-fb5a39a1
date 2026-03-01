import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Zap, CheckCircle2, XCircle, ExternalLink, Rocket } from 'lucide-react';

interface PipelineStep {
  step: string;
  status: string;
  detail?: any;
}

const STEP_LABELS: Record<string, string> = {
  generate: '🧠 Produkt generieren',
  render_screen: '📱 Screen-PDF rendern',
  render_print: '🖨️ Print-PDF rendern',
  publish: '🚀 Stripe Publish',
  seo: '🌐 SEO / Landing',
};

export default function BerufsKIPipelinePage() {
  const [selectedBeruf, setSelectedBeruf] = useState('');
  const [tier, setTier] = useState('19');

  const { data: berufe = [] } = useQuery({
    queryKey: ['berufski-berufe-pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase.from('berufski_berufe').select('id, slug, name').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const pipeline = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('berufski-auto-pipeline', {
        body: { berufskiId: selectedBeruf, tier },
      });
      if (error) throw error;
      return data as { ok: boolean; productId: string; landingUrl: string; steps: PipelineStep[] };
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success('Pipeline komplett! Produkt ist live.', { description: data.landingUrl });
      } else {
        toast.warning('Pipeline teilweise abgeschlossen – siehe Details');
      }
    },
    onError: (e) => toast.error(`Pipeline-Fehler: ${(e as Error).message}`),
  });

  const beruf = berufe.find((b: any) => b.id === selectedBeruf);
  const steps = pipeline.data?.steps || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Auto-Pipeline (1-Click)</h1>
        <p className="text-muted-foreground">
          Generate → PDF Export → Stripe Publish → SEO in einem Klick
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" />Pipeline starten</CardTitle>
          <CardDescription>
            Wähle einen Beruf und Tier — das System generiert das Produkt, exportiert PDFs (Screen + Print),
            publiziert via Stripe und aktiviert die Landing-Page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <Select value={selectedBeruf} onValueChange={setSelectedBeruf}>
                <SelectTrigger><SelectValue placeholder="Beruf wählen…" /></SelectTrigger>
                <SelectContent>
                  {berufe.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="9">Prompt Guide (9€)</SelectItem>
                <SelectItem value="19">Praxisleitfaden (19€)</SelectItem>
                <SelectItem value="29">Komplettsystem (29€)</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={() => pipeline.mutate()}
              disabled={!selectedBeruf || pipeline.isPending}
              size="lg"
            >
              {pipeline.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Pipeline läuft (~60s)…</>
              ) : (
                <><Zap className="mr-2 h-4 w-4" />Pipeline starten</>
              )}
            </Button>
          </div>

          {beruf && (
            <p className="mt-3 text-sm text-muted-foreground">
              Beruf: <strong>{beruf.name}</strong> · Slug: {beruf.slug}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Steps */}
      {steps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline-Ergebnis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  {s.status === 'ok' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  <span className="font-medium">{STEP_LABELS[s.step] || s.step}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.status === 'ok' ? 'default' : 'destructive'}>{s.status}</Badge>
                  {typeof s.detail === 'string' && (
                    <span className="text-xs text-muted-foreground max-w-xs truncate">{s.detail}</span>
                  )}
                </div>
              </div>
            ))}

            {pipeline.data?.landingUrl && (
              <div className="pt-3 flex items-center gap-3">
                <a
                  href={pipeline.data.landingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  Landing-Page ansehen
                </a>
                <span className="text-xs text-muted-foreground">Product ID: {pipeline.data.productId}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
