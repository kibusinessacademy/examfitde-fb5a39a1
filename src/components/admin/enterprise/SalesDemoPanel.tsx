import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Play, Users, AlertTriangle, CheckCircle2, XCircle, TrendingUp,
  Phone, Mail, Copy, ChevronRight, Zap, Shield, Target, MessageSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DEMO_AZUBIS = [
  { name: 'Max Mustermann', email: 'max.mustermann@siemens.de', readiness: 32, risk: 'high', inactive_days: 0, last_exam: 42, status: '🔴' },
  { name: 'Anna Müller', email: 'anna.mueller@siemens.de', readiness: 55, risk: 'medium', inactive_days: 3, last_exam: 61, status: '🟡' },
  { name: 'Tim Becker', email: 'tim.becker@siemens.de', readiness: 78, risk: 'low', inactive_days: 1, last_exam: 82, status: '🟢' },
  { name: 'Lisa Schmidt', email: 'lisa.schmidt@siemens.de', readiness: 0, risk: 'critical', inactive_days: 21, last_exam: 0, status: '⚫' },
  { name: 'Jonas Weber', email: 'jonas.weber@siemens.de', readiness: 91, risk: 'none', inactive_days: 0, last_exam: 94, status: '🟢' },
];

const CLOSING_SCRIPT = [
  { phase: 'Diagnose', color: 'bg-primary/10 text-primary', lines: [
    '„Wie messen Sie aktuell die Prüfungsreife Ihrer Azubis?"',
    '(Pause — Schmerz sichtbar machen)',
    '„Und wann merken Sie, dass jemand durchfällt? Vor oder nach der Prüfung?"',
  ]},
  { phase: 'Problem verstärken', color: 'bg-warning/10 text-warning', lines: [
    '„Das heißt, Sie reagieren erst, wenn es zu spät ist?"',
    '„Das ist genau das Problem, das wir lösen."',
  ]},
  { phase: 'Demo', color: 'bg-success/10 text-success', lines: [
    '→ Dashboard zeigen (Prüfungsreife-Übersicht)',
    '→ Kritischen Fall öffnen (Max Mustermann, 32%)',
    '→ Intervention demonstrieren (1-Click Kontakt)',
  ]},
  { phase: 'Closing', color: 'bg-destructive/10 text-destructive', lines: [
    '„Wenn Sie heute sehen könnten, wer durchfällt — würden Sie das nutzen?"',
    '(Pause)',
    '„Dann macht ein Pilot für einen Ausbildungsjahrgang Sinn."',
  ]},
];

const OBJECTIONS = [
  { objection: '„Wir haben schon ein LMS"', response: '„Perfekt — wir ersetzen kein LMS. Wir sind das System, das zeigt, ob Ihre Azubis die Prüfung bestehen. Ihr LMS zeigt Inhalte. Wir zeigen Risiko."' },
  { objection: '„Zu teuer"', response: '„Was kostet es Sie, wenn 5 Azubis durchfallen?" (Pause) „Wir reden hier nicht über Software — sondern über Bestehensquote."' },
  { objection: '„IT Integration ist schwierig"', response: '„SSO + SCIM ist Standard bei uns. Azure und Okta sind in wenigen Minuten integriert."' },
  { objection: '„Datenschutz"', response: '„Alle Daten liegen in der EU (Frankfurt), inkl. vollständiger DSGVO- und AI-Act-Dokumentation."' },
  { objection: '„Unsere Ausbilder machen das schon"', response: '„Absolut — aber Ihr Ausbilder kann nicht 50 Azubis gleichzeitig überwachen. Wir geben ihm genau die 5, die kritisch sind."' },
];

const OUTBOUND_TEMPLATES = {
  linkedin_connect: 'Hi [Name], kurze Frage:\n\nWie behaltet ihr aktuell im Blick, welche Azubis wirklich prüfungsbereit sind?\n\nViele Grüße\n[Dein Name]',
  linkedin_followup: 'Danke fürs Vernetzen!\n\nIch spreche aktuell viel mit Ausbildungsleitern – die meisten sehen erst nach der Prüfung, wer Probleme hatte.\n\nWie ist das bei euch?',
  linkedin_pitch: 'Genau das lösen wir:\n\nWir zeigen vor der Prüfung:\n- Prüfungsreife (%)\n- Durchfallrisiko\n- konkrete Handlungsempfehlungen\n\nWenn du magst, zeige ich dir das in 5 Minuten live.\n\n👉 [Demo-Link]',
  cold_email: 'Betreff: Prüfungsreife Ihrer Azubis — sichtbar vor der Prüfung\n\nHi [Name],\n\nkurze Frage: Wissen Sie aktuell vor der Prüfung, welche Ihrer Auszubildenden durchfallen könnten?\n\nViele Unternehmen sehen das erst im Nachhinein — wir machen das vorher sichtbar.\n\nMit ExamFit sehen Sie:\n- Prüfungsreife pro Azubi (%)\n- Risiko-Level\n- konkrete Handlungsempfehlungen\n\nFalls das relevant ist, zeige ich Ihnen das gerne in 5 Minuten live.\n\n👉 [Demo-Link]\n\nViele Grüße\n[Dein Name]',
};

function RiskBadge({ risk }: { risk: string }) {
  const config: Record<string, { label: string; className: string }> = {
    critical: { label: 'Kritisch', className: 'bg-destructive text-destructive-foreground' },
    high: { label: 'Hoch', className: 'bg-destructive/80 text-destructive-foreground' },
    medium: { label: 'Mittel', className: 'bg-warning text-warning-foreground' },
    low: { label: 'Niedrig', className: 'bg-success/80 text-success-foreground' },
    none: { label: 'Kein Risiko', className: 'bg-success text-success-foreground' },
  };
  const c = config[risk] || config.low;
  return <Badge className={cn("text-[10px]", c.className)}>{c.label}</Badge>;
}

export default function SalesDemoPanel() {
  const [selectedAzubi, setSelectedAzubi] = useState<typeof DEMO_AZUBIS[0] | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" /> Sales Demo Environment
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Demo-Daten, Closing-Scripts, Einwandbehandlung & Outbound-Templates</p>
      </div>

      <Tabs defaultValue="demo" className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="demo" className="text-xs gap-1"><Play className="h-3 w-3" />Live Demo</TabsTrigger>
          <TabsTrigger value="closing" className="text-xs gap-1"><Target className="h-3 w-3" />Closing</TabsTrigger>
          <TabsTrigger value="objections" className="text-xs gap-1"><Shield className="h-3 w-3" />Einwände</TabsTrigger>
          <TabsTrigger value="outbound" className="text-xs gap-1"><Mail className="h-3 w-3" />Outbound</TabsTrigger>
        </TabsList>

        {/* Live Demo Tab */}
        <TabsContent value="demo" className="mt-4 space-y-4">
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Siemens Ausbildungszentrum</CardTitle>
              <CardDescription className="text-xs">Demo-Organisation · 5 Azubis · Fachinformatiker</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="text-center p-2 rounded-lg bg-muted">
                  <div className="text-lg font-bold">5</div>
                  <div className="text-[10px] text-muted-foreground">Azubis</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-destructive/10">
                  <div className="text-lg font-bold text-destructive">2</div>
                  <div className="text-[10px] text-muted-foreground">Kritisch</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-warning/10">
                  <div className="text-lg font-bold text-warning">1</div>
                  <div className="text-[10px] text-muted-foreground">Gefährdet</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-success/10">
                  <div className="text-lg font-bold text-success">2</div>
                  <div className="text-[10px] text-muted-foreground">Bereit</div>
                </div>
              </div>

              <div className="space-y-2">
                {DEMO_AZUBIS.map(a => (
                  <div
                    key={a.email}
                    className={cn("flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/50", selectedAzubi?.email === a.email && "ring-2 ring-primary bg-primary/5")}
                    onClick={() => setSelectedAzubi(a)}
                  >
                    <span className="text-lg">{a.status}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.email}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold">{a.readiness}%</div>
                      <div className="text-[10px] text-muted-foreground">Prüfungsreife</div>
                    </div>
                    <RiskBadge risk={a.risk} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedAzubi && (
            <Card className="border-warning/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{selectedAzubi.status} {selectedAzubi.name}</CardTitle>
                <CardDescription className="text-xs">{selectedAzubi.email}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted p-2 text-center">
                    <div className="text-lg font-bold">{selectedAzubi.readiness}%</div>
                    <div className="text-[10px] text-muted-foreground">Prüfungsreife</div>
                  </div>
                  <div className="rounded-lg bg-muted p-2 text-center">
                    <div className="text-lg font-bold">{selectedAzubi.inactive_days}d</div>
                    <div className="text-[10px] text-muted-foreground">Inaktiv</div>
                  </div>
                  <div className="rounded-lg bg-muted p-2 text-center">
                    <div className="text-lg font-bold">{selectedAzubi.last_exam}%</div>
                    <div className="text-[10px] text-muted-foreground">Letzte Prüfung</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => toast.success('Demo: Intervention gesendet')}><Mail className="h-3.5 w-3.5" /> Kontaktieren</Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => toast.success('Demo: Erinnerung gesendet')}><Zap className="h-3.5 w-3.5" /> Erinnerung</Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => toast.success('Demo: Termin erstellt')}><Phone className="h-3.5 w-3.5" /> Termin</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Closing Script Tab */}
        <TabsContent value="closing" className="mt-4 space-y-4">
          {CLOSING_SCRIPT.map((phase, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Badge className={cn("w-fit text-xs", phase.color)}>Phase {i + 1}: {phase.phase}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {phase.lines.map((line, j) => (
                  <div key={j} className="flex items-start gap-2">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-sm">{line}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-primary">💡 GOLDENE REGEL</p>
              <p className="text-sm mt-1">Nie Preis zuerst. Immer: Problem → Impact → Lösung → Pilot</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Objections Tab */}
        <TabsContent value="objections" className="mt-4 space-y-3">
          {OBJECTIONS.map((o, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-sm font-semibold">{o.objection}</span>
                </div>
                <div className="flex items-start gap-2 pl-6">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">{o.response}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Outbound Tab */}
        <TabsContent value="outbound" className="mt-4 space-y-4">
          {([
            { key: 'linkedin_connect', title: 'LinkedIn: Connection Request', icon: MessageSquare },
            { key: 'linkedin_followup', title: 'LinkedIn: Follow-Up', icon: MessageSquare },
            { key: 'linkedin_pitch', title: 'LinkedIn: Soft Pitch', icon: Target },
            { key: 'cold_email', title: 'Cold E-Mail', icon: Mail },
          ] as const).map(t => (
            <Card key={t.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><t.icon className="h-4 w-4 text-primary" />{t.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded-lg whitespace-pre-wrap font-sans">{OUTBOUND_TEMPLATES[t.key]}</pre>
                <Button variant="ghost" size="sm" className="mt-2 gap-1" onClick={() => { navigator.clipboard.writeText(OUTBOUND_TEMPLATES[t.key]); toast.success('Kopiert'); }}>
                  <Copy className="h-3.5 w-3.5" /> Kopieren
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
