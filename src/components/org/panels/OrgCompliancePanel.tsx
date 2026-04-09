import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, FileText, Download, Scale, Lock } from 'lucide-react';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';

interface Props {
  orgId: string;
}

const DOCS = [
  { title: 'DSGVO Verarbeitungsverzeichnis', type: 'dsgvo', icon: Shield },
  { title: 'AI Act Einordnung', type: 'ai_act', icon: Scale },
  { title: 'Security Sheet', type: 'security', icon: Lock },
  { title: 'Technisch-organisatorische Maßnahmen', type: 'tom', icon: FileText },
];

export default function OrgCompliancePanel({ orgId }: Props) {
  const [subTab, setSubTab] = useState('documents');

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Verfügbare Dokumente" value={DOCS.length} icon={<FileText className="h-4 w-4 text-primary" />} />
        <KpiCard label="Offene Anfragen" value={0} icon={<Shield className="h-4 w-4 text-muted-foreground" />} />
      </CommandKpiStrip>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="bg-transparent p-0 gap-1">
          <TabsTrigger value="documents" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Dokumente</TabsTrigger>
          <TabsTrigger value="data-rights" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Betroffenenrechte</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <div className="grid sm:grid-cols-2 gap-4">
            {DOCS.map(doc => (
              <Card key={doc.type}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <doc.icon className="h-4 w-4 text-primary" />
                    {doc.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs gap-1.5">
                    <Download className="h-3 w-3" /> Herunterladen
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs">
                    Neu generieren
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="data-rights">
          <Card>
            <CardContent className="py-8 text-center">
              <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-sm font-semibold mb-1">Betroffenenrechte</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Hier können Datenauskunft (Art. 15) und Löschanfragen (Art. 17) für Nutzer Ihrer Organisation eingereicht werden.
              </p>
              <div className="flex gap-2 justify-center mt-4">
                <Button variant="outline" size="sm" className="text-xs">Datenauskunft anfragen</Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive">Löschung beantragen</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
