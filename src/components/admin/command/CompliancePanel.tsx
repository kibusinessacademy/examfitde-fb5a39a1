import { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Shield, FileText, Download, RefreshCw, Trash2, UserX,
  Bot, Lock, Globe, CheckCircle2, AlertTriangle, Database
} from 'lucide-react';
import {
  useComplianceDocuments,
  useDataExportRequests,
  useExportUserData,
  useDeleteUserData,
  useGenerateComplianceDoc,
} from '@/hooks/useCompliance';
import { toast } from 'sonner';

// Compliance report templates
const REPORT_TEMPLATES: Record<string, { title: string; generator: () => string }> = {
  gdpr_report: {
    title: 'DSGVO-Konformitätsbericht',
    generator: () => `# DSGVO-Konformitätsbericht – ExamFit

## 1. Verantwortlicher
ExamFit GmbH – Plattform für berufliche Prüfungsvorbereitung

## 2. Rechtsgrundlagen
- **Art. 6 Abs. 1 lit. b DSGVO** – Vertragserfüllung (Lernplattform-Zugang)
- **Art. 6 Abs. 1 lit. f DSGVO** – Berechtigtes Interesse (Plattformverbesserung)

## 3. Verarbeitete Datenkategorien
| Kategorie | Beispiele | Speicherdauer |
|-----------|-----------|---------------|
| Stammdaten | Name, E-Mail | Vertragsdauer + 6 Monate |
| Lernverhalten | Fortschritt, Scores | Vertragsdauer |
| Prüfungsdaten | Antworten, Ergebnisse | Vertragsdauer |
| Nutzungsdaten | Login, Aktivität | 12 Monate |
| Organisationsdaten | Firma, Rolle | Vertragsdauer |

## 4. Technische Maßnahmen
- **Verschlüsselung**: TLS 1.3 (Transit), AES-256 (At Rest)
- **Zugriffskontrolle**: Row-Level Security (RLS), rollenbasiert
- **Datenisolation**: Mandantentrennung via Organisation-ID
- **Audit-Logging**: Alle administrativen Aktionen protokolliert

## 5. Betroffenenrechte (Art. 15–22)
- ✅ **Auskunft** – Automatisierter JSON-Export via \`fn_export_user_data\`
- ✅ **Löschung** – Anonymisierung via \`fn_request_data_deletion\`
- ✅ **Berichtigung** – Self-Service im Profil
- ✅ **Datenübertragbarkeit** – JSON-Export-Format

## 6. Auftragsverarbeitung
- Hosting: EU-Region (Supabase / AWS Frankfurt)
- Keine Datenübermittlung in Drittländer ohne Angemessenheitsbeschluss

## 7. Löschkonzept
- Automatische Anonymisierung nach Vertragsende
- Soft-Delete mit konfigurierbarer Retention Period
- Aggregierte Statistiken bleiben erhalten

_Generiert am: ${new Date().toLocaleDateString('de-DE')}_`,
  },
  ai_act_report: {
    title: 'EU AI Act – Einordnung & Maßnahmen',
    generator: () => `# EU AI Act – Risikoeinordnung ExamFit

## 1. Systemklassifikation
**Risikokategorie: Begrenztes Risiko (Limited Risk)**

Der KI-Tutor von ExamFit fällt unter Art. 50 EU AI Act (Transparenzpflichten), da er:
- Lernende bei der Prüfungsvorbereitung unterstützt
- Keine autonomen Bewertungsentscheidungen trifft
- Ausschließlich auf SSOT-Curriculum-Daten basiert

## 2. Transparenzpflichten (Art. 50)
- ✅ Kennzeichnung: "Du interagierst mit KI" in jeder Tutor-Session
- ✅ Quellennachveis: Jede Antwort referenziert Kompetenz/Lektion
- ✅ Keine generativen Freestyle-Inhalte

## 3. Technische Schutzmaßnahmen
| Maßnahme | Status | Details |
|----------|--------|---------|
| SSOT-Grounding | ✅ Aktiv | KI nutzt nur verifizierte Curriculum-Daten |
| Response-Logging | ✅ Aktiv | Jede Antwort wird mit Kontext geloggt |
| Human Oversight | ✅ Aktiv | Admin kann Sessions einsehen |
| Keine Bewertungsautonomie | ✅ Aktiv | KI bewertet nicht über Bestehen/Nichtbestehen |

## 4. Verwendete Modelle
- Modelle werden über Lovable AI Gateway geroutet
- Keine proprietären Trainingsdaten von Nutzern
- Prompt-Templates sind versioniert und auditierbar

## 5. Bias-Prävention
- Curricula stammen aus offiziellen Rahmenlehrplänen
- Keine demographische Profilierung
- Gleiche Lernpfade für alle Nutzer einer Zertifizierung

## 6. Dokumentation
- \`ai_interaction_logs\` – Vollständiges Interaktionsprotokoll
- \`ai_tutor_policies\` – Versionierte Steuerungsregeln
- \`ai_governance_reviews\` – Regelmäßige Überprüfungen

_Generiert am: ${new Date().toLocaleDateString('de-DE')}_`,
  },
  security_sheet: {
    title: 'Security & Architektur',
    generator: () => `# Security-Datenblatt – ExamFit

## 1. Architekturübersicht
- **Frontend**: React SPA (keine serverseitige Datenhaltung)
- **Backend**: Supabase (PostgreSQL, Edge Functions, Auth)
- **Hosting**: EU-Region (AWS Frankfurt / eu-central-1)

## 2. Authentifizierung
| Methode | Status |
|---------|--------|
| E-Mail + Passwort | ✅ Aktiv |
| SSO (OIDC/SAML) | ✅ Unterstützt |
| SCIM 2.0 Provisioning | ✅ Aktiv |
| MFA/2FA | ✅ Optional |

## 3. Autorisierung
- **Row-Level Security (RLS)**: Alle Tabellen geschützt
- **Rollenmodell**: admin, owner, manager, trainer, learner
- **Org-Isolation**: Daten strikt nach Organisation getrennt

## 4. Verschlüsselung
- **In Transit**: TLS 1.3
- **At Rest**: AES-256 (Supabase-managed)
- **Secrets**: Vault-basierte Speicherung

## 5. Schnittstellen
| Interface | Sicherheit |
|-----------|-----------|
| SCIM 2.0 | Bearer Token (SHA-256 gehasht) |
| LTI 1.3 | JWT + JWKS Verification |
| Admin API | Bearer JWT + Admin-Role-Check |
| Bulk Import | Authenticated + Admin-only |

## 6. Audit & Monitoring
- Alle Admin-Aktionen geloggt (\`admin_actions\`)
- AI-Interaktionen protokolliert (\`ai_interaction_logs\`)
- Datenexport/-löschung nachvollziehbar (\`data_export_requests\`)

## 7. Incident Response
- Automatische Alerts bei Security-Events
- Eskalationspfad über Admin-Leitstelle

_Generiert am: ${new Date().toLocaleDateString('de-DE')}_`,
  },
  full_audit: {
    title: 'Vollständiger Audit-Bericht',
    generator: () => `# Audit-Bericht – ExamFit Platform

## Zusammenfassung
Dieser Bericht fasst die Compliance-Lage der ExamFit-Plattform zusammen und dient als Prüfgrundlage für IT-Leiter, Datenschutzbeauftragte und externe Auditoren.

## 1. Datenschutz (DSGVO)
- Rechtsgrundlagen dokumentiert ✅
- Verarbeitungsverzeichnis vorhanden ✅
- Betroffenenrechte automatisiert ✅
- Löschkonzept implementiert ✅
- AV-Verträge vorhanden ✅

## 2. KI-Compliance (EU AI Act)
- Risikoklassifikation: Limited Risk ✅
- Transparenzkennzeichnung aktiv ✅
- SSOT-Grounding erzwungen ✅
- Response-Logging vollständig ✅
- Keine autonome Bewertung ✅

## 3. Sicherheit
- Encryption at rest + in transit ✅
- RLS auf allen Tabellen ✅
- Rollenbasierte Zugriffskontrolle ✅
- Audit-Logging aktiv ✅

## 4. Schnittstellen
- SCIM 2.0: Token-basiert, gehashed ✅
- LTI 1.3: JWT-verifiziert ✅
- CSV Import: Validiert, idempotent ✅

## 5. Hosting & Infrastruktur
- Region: EU (Frankfurt)
- Subprozessoren: Supabase (EU), Lovable (EU)
- Keine US-Datentransfers ohne SCCs

## 6. Empfehlungen
- [ ] Jährliche externe Penetration Tests
- [ ] ISO 27001 Zertifizierung anstreben
- [ ] AZAV-Audit-Schedule etablieren

_Generiert am: ${new Date().toLocaleDateString('de-DE')}_`,
  },
};

interface CompliancePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CompliancePanel({ open, onOpenChange }: CompliancePanelProps) {
  const { data: docs, isLoading: docsLoading } = useComplianceDocuments();
  const { data: requests, isLoading: reqLoading } = useDataExportRequests();
  const generateDoc = useGenerateComplianceDoc();
  const exportUser = useExportUserData();
  const deleteUser = useDeleteUserData();
  const [exportUserId, setExportUserId] = useState('');
  const [deleteUserId, setDeleteUserId] = useState('');

  const handleGenerateReport = (docType: string) => {
    const template = REPORT_TEMPLATES[docType];
    if (!template) return;
    generateDoc.mutate({
      doc_type: docType,
      title: template.title,
      content_md: template.generator(),
    });
  };

  const handleExport = () => {
    if (!exportUserId.trim()) return toast.error('User-ID eingeben');
    exportUser.mutate(exportUserId.trim());
    setExportUserId('');
  };

  const handleDelete = () => {
    if (!deleteUserId.trim()) return toast.error('User-ID eingeben');
    if (!confirm('Nutzerdaten wirklich anonymisieren/löschen? Dies kann nicht rückgängig gemacht werden.')) return;
    deleteUser.mutate(deleteUserId.trim());
    setDeleteUserId('');
  };

  const downloadMarkdown = (doc: { title: string; content_md: string }) => {
    const blob = new Blob([doc.content_md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Compliance & Datenschutz
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" className="text-xs">Übersicht</TabsTrigger>
            <TabsTrigger value="documents" className="text-xs">Dokumente</TabsTrigger>
            <TabsTrigger value="rights" className="text-xs">Betroffene</TabsTrigger>
            <TabsTrigger value="ai" className="text-xs">AI Act</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid gap-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lock className="h-4 w-4 text-success" /> DSGVO
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {['Rechtsgrundlagen dokumentiert', 'Betroffenenrechte automatisiert', 'Löschkonzept implementiert', 'AV-Verträge vorhanden'].map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" /> EU AI Act
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {['Limited Risk Klassifikation', 'SSOT-Grounding erzwungen', 'Transparenzkennzeichnung aktiv', 'Keine autonome Bewertung'].map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-warning" /> Security
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {['TLS 1.3 + AES-256', 'RLS auf allen Tabellen', 'Rollenbasierte Zugriffskontrolle', 'Audit-Logging aktiv'].map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground" /> Hosting
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1">
                  <p>Region: <span className="font-medium text-foreground">EU (Frankfurt)</span></p>
                  <p>Subprozessoren: Supabase (EU), Lovable (EU)</p>
                  <p>Keine US-Datentransfers ohne Angemessenheitsbeschluss</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Berichte generieren</CardTitle>
                <CardDescription className="text-xs">Erstelle prüffähige Compliance-Dokumente für IT-Leiter und Auditoren</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(REPORT_TEMPLATES).map(([key, tmpl]) => (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 text-xs"
                    onClick={() => handleGenerateReport(key)}
                    disabled={generateDoc.isPending}
                  >
                    <FileText className="h-3 w-3" />
                    {tmpl.title}
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" /> Generierte Dokumente
                </CardTitle>
              </CardHeader>
              <CardContent>
                {docsLoading ? (
                  <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-10" />)}</div>
                ) : !docs?.length ? (
                  <p className="text-xs text-muted-foreground">Noch keine Dokumente erstellt</p>
                ) : (
                  <div className="space-y-2">
                    {docs.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{doc.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            v{doc.version} · {new Date(doc.created_at).toLocaleDateString('de-DE')}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => downloadMarkdown(doc)}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Subject Rights Tab */}
          <TabsContent value="rights" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Datenexport (Art. 15 DSGVO)
                </CardTitle>
                <CardDescription className="text-xs">Exportiere alle personenbezogenen Daten eines Nutzers als JSON</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Input
                  placeholder="User-ID (UUID)"
                  value={exportUserId}
                  onChange={e => setExportUserId(e.target.value)}
                  className="text-xs"
                />
                <Button size="sm" onClick={handleExport} disabled={exportUser.isPending}>
                  <Download className="h-3 w-3 mr-1" /> Export
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserX className="h-4 w-4 text-destructive" /> Datenlöschung (Art. 17 DSGVO)
                </CardTitle>
                <CardDescription className="text-xs">Anonymisiert Nutzerdaten und löscht personenbezogene Informationen</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Input
                  placeholder="User-ID (UUID)"
                  value={deleteUserId}
                  onChange={e => setDeleteUserId(e.target.value)}
                  className="text-xs"
                />
                <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleteUser.isPending}>
                  <Trash2 className="h-3 w-3 mr-1" /> Löschen
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Anfragen-Protokoll</CardTitle>
              </CardHeader>
              <CardContent>
                {reqLoading ? (
                  <Skeleton className="h-16" />
                ) : !requests?.length ? (
                  <p className="text-xs text-muted-foreground">Keine Anfragen</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {requests.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between rounded border border-border p-2 text-xs">
                        <div>
                          <Badge variant="outline" className="text-[10px]">{r.request_type}</Badge>
                          <span className="ml-2 text-muted-foreground">{r.target_user_id?.slice(0, 8)}…</span>
                        </div>
                        <Badge className={r.status === 'completed' ? 'bg-success/10 text-success border-success/30' : 'bg-warning/10 text-warning border-warning/30'}>
                          {r.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Act Tab */}
          <TabsContent value="ai" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bot className="h-4 w-4" /> KI-System Klassifikation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                  <p className="text-xs font-semibold text-primary">Begrenztes Risiko (Limited Risk)</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Art. 50 EU AI Act – Transparenzpflichten für KI-Systeme, die mit Menschen interagieren
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold">Warum nicht "High Risk"?</h4>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
                      <span>KI trifft <strong>keine</strong> Bewertungsentscheidungen (Bestehen/Nichtbestehen)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
                      <span>Unterstützend, nicht entscheidend – der Lernende steuert</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
                      <span>Kein Profiling, keine Diskriminierungsgefahr</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold">Implementierte Maßnahmen</h4>
                  <div className="grid gap-2">
                    {[
                      { label: 'SSOT-Grounding', desc: 'Antworten nur aus verifizierten Curriculum-Daten' },
                      { label: 'Transparenz', desc: '"Du interagierst mit KI" in jeder Session' },
                      { label: 'Logging', desc: 'Jede Interaktion mit Kontext protokolliert' },
                      { label: 'Human Oversight', desc: 'Admin kann alle Sessions einsehen' },
                      { label: 'Quellenverweis', desc: 'Jede Antwort referenziert Kompetenz/Lektion' },
                    ].map(m => (
                      <div key={m.label} className="rounded border border-border p-2">
                        <p className="text-xs font-medium">{m.label}</p>
                        <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
