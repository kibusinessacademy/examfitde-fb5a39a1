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
  Shield, FileText, Download, Trash2, UserX,
  Bot, Lock, Globe, CheckCircle2, Database, FileDown,
  Server, Key, Eye, Network, Layers
} from 'lucide-react';
import {
  useComplianceDocuments,
  useDataExportRequests,
  useExportUserData,
  useDeleteUserData,
  useGenerateComplianceDoc,
} from '@/hooks/useCompliance';
import { useGenerateCompliancePdf } from '@/hooks/useCompliancePdf';
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
- ✅ **Auskunft** – Automatisierter JSON-Export
- ✅ **Löschung** – Anonymisierung per Admin-Tool
- ✅ **Berichtigung** – Self-Service im Profil
- ✅ **Datenübertragbarkeit** – JSON-Export-Format

## 6. Auftragsverarbeitung
- Hosting: EU-Region (AWS Frankfurt)
- Keine Datenübermittlung in Drittländer ohne Angemessenheitsbeschluss

## 7. Löschkonzept
- Automatische Anonymisierung nach Vertragsende
- Soft-Delete mit konfigurierbarer Retention Period
- Aggregierte Statistiken bleiben erhalten

## 8. Prüfungsdaten als personenbezogene Leistungsdaten
- Prüfungsantworten und Ergebnisse = personenbezogene Leistungsdaten
- Zugriff nur durch den Nutzer selbst und autorisierte Admins
- Keine Weitergabe an Dritte ohne explizite Einwilligung

## 9. Organisatorische Maßnahmen
- Datenschutzschulungen für Administratoren
- Zugriffsprotokollierung aller Admin-Aktionen
- Regelmäßige interne Audits
- Eskalationspfad bei Datenschutzvorfällen

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
- ✅ Quellenverweis: Jede Antwort referenziert Kompetenz/Lektion
- ✅ Keine generativen Freestyle-Inhalte

## 3. Technische Schutzmaßnahmen
| Maßnahme | Status | Details |
|----------|--------|---------|
| SSOT-Grounding | ✅ Aktiv | KI nutzt nur verifizierte Curriculum-Daten |
| Response-Logging | ✅ Aktiv | Jede Antwort wird mit Kontext geloggt |
| Human Oversight | ✅ Aktiv | Admin kann Sessions einsehen |
| Keine Bewertungsautonomie | ✅ Aktiv | KI bewertet nicht über Bestehen/Nichtbestehen |

## 4. KI-Tutor als unterstützendes System
- Der Tutor ist **ausschließlich unterstützend** – keine autonome Bestehensentscheidung
- Prüfungsergebnisse werden durch deterministische Algorithmen berechnet
- Kein generativer Freestyle-Content: alle Antworten sind curriculum-gebunden

## 5. Verwendete Modelle
- Modelle werden über Lovable AI Gateway geroutet
- Keine proprietären Trainingsdaten von Nutzern
- Prompt-Templates sind versioniert und auditierbar

## 6. Bias-Prävention
- Curricula stammen aus offiziellen Rahmenlehrplänen
- Keine demographische Profilierung
- Gleiche Lernpfade für alle Nutzer einer Zertifizierung

## 7. Dokumentation & Nachvollziehbarkeit
- ai_interaction_logs – Vollständiges Interaktionsprotokoll
- ai_tutor_policies – Versionierte Steuerungsregeln
- ai_governance_reviews – Regelmäßige Überprüfungen

_Generiert am: ${new Date().toLocaleDateString('de-DE')}_`,
  },
  security_sheet: {
    title: 'Security & Architektur',
    generator: () => `# Security-Datenblatt – ExamFit

## 1. Architekturübersicht
- **Frontend**: React SPA (keine serverseitige Datenhaltung)
- **Backend**: PostgreSQL + Edge Functions + Auth
- **Hosting**: EU-Region (AWS Frankfurt / eu-central-1)

## 2. Authentifizierung
| Methode | Status |
|---------|--------|
| E-Mail + Passwort | ✅ Aktiv |
| SSO (OIDC/SAML) | ✅ Unterstützt |
| SCIM 2.0 Provisioning | ✅ Aktiv |
| MFA/2FA | ✅ Optional |

## 3. Autorisierung & Rollen-/Mandantentrennung
- **Row-Level Security (RLS)**: Alle Tabellen geschützt
- **Rollenmodell**: admin, owner, manager, trainer, learner
- **Org-Isolation**: Daten strikt nach Organisation getrennt
- **Didaktische Queries**: immer gefiltert auf user_id + curriculum_id

## 4. Verschlüsselung
- **In Transit**: TLS 1.3
- **At Rest**: AES-256
- **Secrets**: Vault-basierte Speicherung

## 5. Schnittstellen-Sicherheit
| Interface | Sicherheit |
|-----------|-----------|
| SCIM 2.0 | Bearer Token (SHA-256 gehasht) |
| LTI 1.3 | JWT + JWKS Verification |
| Admin API | Bearer JWT + Admin-Role-Check |
| Bulk Import | Authenticated + Admin-only + Validierung |

## 6. Audit & Monitoring
- Alle Admin-Aktionen geloggt (admin_actions)
- AI-Interaktionen protokolliert (ai_interaction_logs)
- Datenexport/-löschung nachvollziehbar (data_export_requests)

## 7. Aufbewahrungs- und Löschlogik
- Personenbezogene Daten: Vertragsdauer + 6 Monate
- Nutzungsdaten: 12 Monate Rolling
- Prüfungsergebnisse: Vertragsdauer
- Aggregierte Statistiken: unbefristet (anonymisiert)

## 8. Incident Response
- Automatische Alerts bei Security-Events
- Eskalationspfad über Admin-Leitstelle
- Dokumentierte Reaktionszeiten

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
- Prüfungsdaten als Leistungsdaten klassifiziert ✅

## 2. KI-Compliance (EU AI Act)
- Risikoklassifikation: Limited Risk ✅
- Transparenzkennzeichnung aktiv ✅
- SSOT-Grounding erzwungen ✅
- Response-Logging vollständig ✅
- Keine autonome Bewertung ✅
- KI-Tutor nur unterstützend ✅

## 3. Sicherheit
- Encryption at rest + in transit ✅
- RLS auf allen Tabellen ✅
- Rollenbasierte Zugriffskontrolle ✅
- Audit-Logging aktiv ✅
- Rollen-/Mandantentrennung ✅

## 4. Schnittstellen
- SCIM 2.0: Token-basiert, gehashed ✅
- LTI 1.3: JWT-verifiziert ✅
- CSV Import: Validiert, idempotent ✅
- Schnittstellen-Sicherheit dokumentiert ✅

## 5. Hosting & Infrastruktur
- Region: EU (Frankfurt)
- Keine US-Datentransfers ohne SCCs

## 6. Exportierbarkeit & Nachweisbarkeit
- Alle Compliance-Dokumente versioniert
- PDF-Export für IT-Leiter verfügbar
- Vollständiges Audit-Log aller Admin-Aktionen
- Datenexport und Löschung nachvollziehbar protokolliert

## 7. Empfehlungen
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
  const generatePdf = useGenerateCompliancePdf();
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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" className="text-[10px] px-1">Übersicht</TabsTrigger>
            <TabsTrigger value="documents" className="text-[10px] px-1">Dokumente</TabsTrigger>
            <TabsTrigger value="rights" className="text-[10px] px-1">Betroffene</TabsTrigger>
            <TabsTrigger value="ai" className="text-[10px] px-1">AI Act</TabsTrigger>
            <TabsTrigger value="security" className="text-[10px] px-1">Security</TabsTrigger>
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
                  {['Rechtsgrundlagen dokumentiert', 'Betroffenenrechte automatisiert', 'Löschkonzept implementiert', 'Prüfungsdaten als Leistungsdaten klassifiziert'].map(item => (
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
                  {['Limited Risk Klassifikation', 'SSOT-Grounding erzwungen', 'Transparenzkennzeichnung aktiv', 'Keine autonome Bewertung', 'KI-Tutor nur unterstützend'].map(item => (
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
                    <Shield className="h-4 w-4 text-warning" /> Security & Schnittstellen
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {['TLS 1.3 + AES-256', 'RLS auf allen Tabellen', 'Rollenbasierte Zugriffskontrolle', 'Audit-Logging aktiv', 'SCIM / LTI / Bulk Import gesichert'].map(item => (
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
                <CardDescription className="text-xs">Markdown- und PDF-Downloads für IT-Leiter</CardDescription>
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
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{doc.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            v{doc.version} · {new Date(doc.created_at).toLocaleDateString('de-DE')}
                            {doc.generated_by && ` · Admin`}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Markdown herunterladen"
                            onClick={() => downloadMarkdown(doc)}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Als PDF generieren & öffnen"
                            onClick={() => generatePdf.mutate(doc.id)}
                            disabled={generatePdf.isPending}
                          >
                            <FileDown className="h-3 w-3 text-primary" />
                          </Button>
                        </div>
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
                <CardDescription className="text-xs">Alle Export- und Löschanfragen werden auditierbar protokolliert</CardDescription>
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
                    {[
                      { text: <>KI trifft <strong>keine</strong> Bewertungsentscheidungen (Bestehen/Nichtbestehen)</> },
                      { text: 'Unterstützend, nicht entscheidend – der Lernende steuert' },
                      { text: 'Kein Profiling, keine Diskriminierungsgefahr' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold">Implementierte Maßnahmen</h4>
                  <div className="grid gap-2">
                    {[
                      { label: 'SSOT-Grounding', desc: 'Antworten nur aus verifizierten Curriculum-Daten', icon: <Layers className="h-3 w-3" /> },
                      { label: 'Transparenz', desc: '"Du interagierst mit KI" in jeder Session', icon: <Eye className="h-3 w-3" /> },
                      { label: 'Logging', desc: 'Jede Interaktion mit Kontext protokolliert', icon: <Database className="h-3 w-3" /> },
                      { label: 'Human Oversight', desc: 'Admin kann alle Sessions einsehen', icon: <Shield className="h-3 w-3" /> },
                      { label: 'Quellenverweis', desc: 'Jede Antwort referenziert Kompetenz/Lektion', icon: <FileText className="h-3 w-3" /> },
                    ].map(m => (
                      <div key={m.label} className="rounded border border-border p-2 flex gap-2 items-start">
                        <span className="text-muted-foreground mt-0.5">{m.icon}</span>
                        <div>
                          <p className="text-xs font-medium">{m.label}</p>
                          <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security & Architecture Tab */}
          <TabsContent value="security" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4" /> Hosting & Infrastruktur
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-border p-2">
                    <p className="text-[10px] text-muted-foreground">Region</p>
                    <p className="font-medium">EU (Frankfurt)</p>
                  </div>
                  <div className="rounded border border-border p-2">
                    <p className="text-[10px] text-muted-foreground">Verschlüsselung</p>
                    <p className="font-medium">TLS 1.3 + AES-256</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Key className="h-4 w-4" /> Auth & Zugriffskontrolle
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: 'SSO (OIDC/SAML)', status: 'Unterstützt' },
                  { label: 'SCIM 2.0 Provisioning', status: 'Aktiv' },
                  { label: 'Row-Level Security', status: 'Alle Tabellen' },
                  { label: 'Rollenmodell', status: 'admin / owner / manager / trainer / learner' },
                  { label: 'Org-Isolation', status: 'Mandantentrennung via Org-ID' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-xs rounded border border-border p-2">
                    <span className="text-muted-foreground">{item.label}</span>
                    <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Network className="h-4 w-4" /> Schnittstellen-Sicherheit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { iface: 'SCIM 2.0', security: 'Bearer Token (SHA-256 gehasht)' },
                  { iface: 'LTI 1.3', security: 'JWT + JWKS Verification' },
                  { iface: 'Admin API', security: 'Bearer JWT + Admin-Role-Check' },
                  { iface: 'Bulk Import', security: 'Authenticated + Admin-only + Validierung' },
                ].map(item => (
                  <div key={item.iface} className="flex items-center justify-between text-xs rounded border border-border p-2">
                    <span className="font-medium">{item.iface}</span>
                    <span className="text-muted-foreground text-[10px]">{item.security}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" /> Audit-Logging
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs text-muted-foreground">
                {[
                  'Alle Admin-Aktionen protokolliert (admin_actions)',
                  'AI-Interaktionen mit Kontext geloggt (ai_interaction_logs)',
                  'Datenexport/-löschung nachvollziehbar (data_export_requests)',
                  'Compliance-Dokumenten-Generierung versioniert',
                ].map(item => (
                  <div key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
