import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Shield, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  FileText,
  Building2,
  GraduationCap,
  ClipboardCheck,
  RefreshCw,
  Loader2,
  Plus,
  Calendar,
  Award,
  AlertCircle,
  Clock,
  FileCheck,
  BookOpen,
  Users,
  TrendingUp
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Types
interface ComplianceCheck {
  check_code: string;
  check_name: string;
  category: string;
  priority: string;
  result: string;
  actual_value: string;
}

interface QMDocument {
  id: string;
  document_type: string;
  title: string;
  description: string | null;
  version: string;
  status: string;
  effective_from: string | null;
  next_review_date: string | null;
  approved_at: string | null;
  created_at: string;
}

interface Fachbereich {
  id: string;
  fachbereich_nummer: number;
  bezeichnung: string;
  beschreibung: string | null;
  sgb_referenz: string | null;
  is_active: boolean;
  zulassung_datum: string | null;
  zulassung_bis: string | null;
  zertifikat_nummer: string | null;
}

interface Massnahme {
  id: string;
  course_id: string;
  curriculum_id: string;
  massnahmen_nummer: string | null;
  zulassung_status: string;
  zulassung_datum: string | null;
  zulassung_bis: string | null;
  fachkundige_stelle: string | null;
  lernform: string | null;
  courses: { title: string } | null;
}

const documentTypeLabels: Record<string, string> = {
  'quality_policy': 'Qualitätspolitik',
  'quality_objectives': 'Qualitätsziele',
  'process_manual': 'Prozesshandbuch',
  'work_instruction': 'Arbeitsanweisung',
  'form_template': 'Formularvorlage',
  'checklist': 'Checkliste',
  'audit_report': 'Auditbericht',
  'management_review': 'Managementbewertung',
  'corrective_action': 'Korrekturmaßnahme',
  'preventive_action': 'Vorbeugemaßnahme',
  'risk_assessment': 'Risikobewertung',
  'competence_matrix': 'Kompetenzmatrix',
  'customer_feedback': 'Kundenfeedback',
  'improvement_suggestion': 'Verbesserungsvorschlag',
  'external_audit': 'Externes Audit',
  'internal_audit': 'Internes Audit',
  'other': 'Sonstiges'
};

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  'draft': { label: 'Entwurf', variant: 'secondary' },
  'review': { label: 'In Prüfung', variant: 'outline' },
  'approved': { label: 'Freigegeben', variant: 'default' },
  'superseded': { label: 'Ersetzt', variant: 'destructive' },
  'archived': { label: 'Archiviert', variant: 'destructive' }
};

const zulassungStatusLabels: Record<string, { label: string; color: string }> = {
  'vorbereitung': { label: 'In Vorbereitung', color: 'bg-gray-500' },
  'beantragt': { label: 'Beantragt', color: 'bg-blue-500' },
  'pruefung': { label: 'In Prüfung', color: 'bg-yellow-500' },
  'nachbesserung': { label: 'Nachbesserung', color: 'bg-orange-500' },
  'zugelassen': { label: 'Zugelassen', color: 'bg-green-500' },
  'abgelaufen': { label: 'Abgelaufen', color: 'bg-red-500' },
  'widerrufen': { label: 'Widerrufen', color: 'bg-red-700' }
};

export default function AZAVCompliancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRunningCheck, setIsRunningCheck] = useState(false);
  const [showDocDialog, setShowDocDialog] = useState(false);
  const [newDoc, setNewDoc] = useState({
    document_type: '',
    title: '',
    description: ''
  });

  // Fetch compliance check results
  const { data: complianceResults, refetch: refetchCompliance } = useQuery({
    queryKey: ['azav-compliance-check'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('run_azav_compliance_check');
      if (error) throw error;
      return data as ComplianceCheck[];
    }
  });

  // Fetch QM documents
  const { data: qmDocuments } = useQuery({
    queryKey: ['qm-documents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qm_documents')
        .select('*')
        .order('document_type')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as QMDocument[];
    }
  });

  // Fetch Fachbereiche
  const { data: fachbereiche } = useQuery({
    queryKey: ['azav-fachbereiche'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('azav_fachbereiche')
        .select('*')
        .order('fachbereich_nummer');
      if (error) throw error;
      return data as Fachbereich[];
    }
  });

  // Fetch Maßnahmen
  const { data: massnahmen } = useQuery({
    queryKey: ['azav-massnahmen'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('azav_massnahmen_zulassungen')
        .select('*, courses(title)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Massnahme[];
    }
  });

  // Fetch dashboard stats
  const { data: dashboardStats } = useQuery({
    queryKey: ['azav-dashboard-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('azav_dashboard_stats')
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }
  });

  // Create QM document mutation
  const createDocMutation = useMutation({
    mutationFn: async (doc: typeof newDoc) => {
      const { data, error } = await supabase
        .from('qm_documents')
        .insert({
          document_type: doc.document_type,
          title: doc.title,
          description: doc.description || null
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qm-documents'] });
      setShowDocDialog(false);
      setNewDoc({ document_type: '', title: '', description: '' });
      toast({ title: 'Dokument erstellt', description: 'QM-Dokument wurde angelegt' });
    },
    onError: (error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    }
  });

  // Run compliance check
  const handleRunCheck = async () => {
    setIsRunningCheck(true);
    try {
      await refetchCompliance();
      toast({ title: 'Compliance-Check abgeschlossen', description: 'Alle Prüfungen wurden durchgeführt' });
    } finally {
      setIsRunningCheck(false);
    }
  };

  // Calculate compliance score
  const complianceScore = complianceResults ? (() => {
    const required = complianceResults.filter(c => c.priority === 'required');
    const passed = required.filter(c => c.result === 'passed').length;
    return required.length > 0 ? Math.round((passed / required.length) * 100) : 0;
  })() : 0;

  // Group compliance results by category
  const groupedCompliance = complianceResults?.reduce((acc, check) => {
    if (!acc[check.category]) acc[check.category] = [];
    acc[check.category].push(check);
    return acc;
  }, {} as Record<string, ComplianceCheck[]>) || {};

  const categoryLabels: Record<string, string> = {
    'traeger_anforderungen': 'Trägeranforderungen (§178)',
    'massnahmen_anforderungen': 'Maßnahmenanforderungen (§179)',
    'qm_system': 'QM-System',
    'personal': 'Personal',
    'infrastruktur': 'Infrastruktur',
    'dokumentation': 'Dokumentation',
    'datenschutz': 'Datenschutz',
    'lernerfolg': 'Lernerfolgskontrollen'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" />
            AZAV Compliance Center
          </h1>
          <p className="text-muted-foreground">
            Trägerzulassung & Qualitätsmanagement nach §178-179 SGB III
          </p>
        </div>
        <Button 
          onClick={handleRunCheck} 
          disabled={isRunningCheck}
          className="gap-2"
        >
          {isRunningCheck ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Compliance-Check
        </Button>
      </div>

      {/* Compliance Score Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Compliance Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className={`text-3xl font-bold ${
                complianceScore >= 80 ? 'text-green-500' : 
                complianceScore >= 60 ? 'text-yellow-500' : 'text-red-500'
              }`}>
                {complianceScore}%
              </div>
              <Progress value={complianceScore} className="flex-1" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Pflichtanforderungen erfüllt
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              QM-Dokumente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.approved_qm_docs || 0}</div>
            <p className="text-xs text-muted-foreground">
              {dashboardStats?.draft_qm_docs || 0} Entwürfe, {dashboardStats?.overdue_reviews || 0} überfällig
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Award className="h-4 w-4" />
              Zugelassene Maßnahmen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.active_massnahmen || 0}</div>
            <p className="text-xs text-muted-foreground">
              {dashboardStats?.expiring_soon || 0} laufen bald ab
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" />
              Audits (12 Monate)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.audits_this_year || 0}</div>
            <p className="text-xs text-muted-foreground">
              {dashboardStats?.recent_evidence_packs || 0} Evidence Packs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="compliance" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="compliance" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Compliance-Check
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            QM-Dokumente
          </TabsTrigger>
          <TabsTrigger value="fachbereiche" className="gap-2">
            <Building2 className="h-4 w-4" />
            Fachbereiche
          </TabsTrigger>
          <TabsTrigger value="massnahmen" className="gap-2">
            <GraduationCap className="h-4 w-4" />
            Maßnahmen
          </TabsTrigger>
        </TabsList>

        {/* Compliance Check Tab */}
        <TabsContent value="compliance" className="space-y-4">
          {Object.entries(groupedCompliance).map(([category, checks]) => (
            <Card key={category} className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">{categoryLabels[category] || category}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Code</TableHead>
                      <TableHead>Anforderung</TableHead>
                      <TableHead className="w-[100px]">Priorität</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checks.map((check) => (
                      <TableRow key={check.check_code}>
                        <TableCell className="font-mono text-xs">{check.check_code}</TableCell>
                        <TableCell>{check.check_name}</TableCell>
                        <TableCell>
                          <Badge variant={check.priority === 'required' ? 'default' : 'secondary'}>
                            {check.priority === 'required' ? 'Pflicht' : 
                             check.priority === 'recommended' ? 'Empfohlen' : 'Optional'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {check.result === 'passed' ? (
                            <Badge className="bg-green-500 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Erfüllt
                            </Badge>
                          ) : check.result === 'failed' ? (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              Offen
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Prüfen
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                          {check.actual_value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* QM Documents Tab */}
        <TabsContent value="documents" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Qualitätsmanagement-Dokumentation</h3>
            <Dialog open={showDocDialog} onOpenChange={setShowDocDialog}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Dokument anlegen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Neues QM-Dokument</DialogTitle>
                  <DialogDescription>
                    Erstellen Sie ein neues Qualitätsmanagement-Dokument
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Dokumenttyp</Label>
                    <Select 
                      value={newDoc.document_type} 
                      onValueChange={(v) => setNewDoc(d => ({ ...d, document_type: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Typ wählen..." />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(documentTypeLabels).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Titel</Label>
                    <Input 
                      value={newDoc.title}
                      onChange={(e) => setNewDoc(d => ({ ...d, title: e.target.value }))}
                      placeholder="Dokumenttitel..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Beschreibung</Label>
                    <Textarea 
                      value={newDoc.description}
                      onChange={(e) => setNewDoc(d => ({ ...d, description: e.target.value }))}
                      placeholder="Kurze Beschreibung..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDocDialog(false)}>
                    Abbrechen
                  </Button>
                  <Button 
                    onClick={() => createDocMutation.mutate(newDoc)}
                    disabled={!newDoc.document_type || !newDoc.title || createDocMutation.isPending}
                  >
                    {createDocMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Erstellen'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="glass-card">
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Typ</TableHead>
                    <TableHead>Titel</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Nächste Prüfung</TableHead>
                    <TableHead>Erstellt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {qmDocuments?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Noch keine QM-Dokumente angelegt
                      </TableCell>
                    </TableRow>
                  )}
                  {qmDocuments?.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Badge variant="outline">
                          {documentTypeLabels[doc.document_type] || doc.document_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{doc.title}</TableCell>
                      <TableCell className="font-mono text-sm">v{doc.version}</TableCell>
                      <TableCell>
                        <Badge variant={statusLabels[doc.status]?.variant || 'default'}>
                          {statusLabels[doc.status]?.label || doc.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {doc.next_review_date ? (
                          <span className={new Date(doc.next_review_date) < new Date() ? 'text-red-500' : ''}>
                            {format(new Date(doc.next_review_date), 'dd.MM.yyyy', { locale: de })}
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(doc.created_at), 'dd.MM.yyyy', { locale: de })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Required Documents Checklist */}
          <Card className="glass-card border-primary/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                AZAV Pflichtdokumente
              </CardTitle>
              <CardDescription>
                Diese Dokumente sind für die Trägerzulassung erforderlich
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {[
                  { type: 'quality_policy', label: 'Qualitätspolitik' },
                  { type: 'quality_objectives', label: 'Qualitätsziele' },
                  { type: 'process_manual', label: 'Prozesshandbuch / QM-Handbuch' },
                  { type: 'management_review', label: 'Managementbewertung (jährlich)' },
                  { type: 'internal_audit', label: 'Interne Auditberichte' },
                  { type: 'corrective_action', label: 'Korrekturmaßnahmenverfahren' },
                  { type: 'competence_matrix', label: 'Kompetenzmatrix Personal' }
                ].map(({ type, label }) => {
                  const exists = qmDocuments?.some(d => d.document_type === type && d.status === 'approved');
                  return (
                    <div key={type} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      {exists ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                      <span className={exists ? 'text-muted-foreground' : 'font-medium'}>
                        {label}
                      </span>
                      {!exists && (
                        <Badge variant="destructive" className="ml-auto">
                          Fehlt
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fachbereiche Tab */}
        <TabsContent value="fachbereiche" className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>AZAV Fachbereiche nach §178 SGB III</CardTitle>
              <CardDescription>
                Aktivieren Sie die Fachbereiche, in denen Sie Maßnahmen anbieten möchten
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {fachbereiche?.map((fb) => (
                  <div 
                    key={fb.id} 
                    className={`p-4 rounded-lg border ${fb.is_active ? 'border-green-500/50 bg-green-500/5' : 'border-muted'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                          fb.is_active ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                        }`}>
                          {fb.fachbereich_nummer}
                        </div>
                        <div>
                          <h4 className="font-semibold">{fb.bezeichnung}</h4>
                          <p className="text-sm text-muted-foreground">{fb.sgb_referenz}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {fb.is_active ? (
                          <>
                            <Badge className="bg-green-500">Aktiv</Badge>
                            {fb.zulassung_bis && (
                              <span className="text-xs text-muted-foreground">
                                bis {format(new Date(fb.zulassung_bis), 'dd.MM.yyyy', { locale: de })}
                              </span>
                            )}
                          </>
                        ) : (
                          <Badge variant="outline">Nicht aktiv</Badge>
                        )}
                      </div>
                    </div>
                    {fb.beschreibung && (
                      <p className="text-sm text-muted-foreground mt-2 ml-13">{fb.beschreibung}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Maßnahmen Tab */}
        <TabsContent value="massnahmen" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Maßnahmenzulassungen</h3>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Maßnahme beantragen
            </Button>
          </div>

          <Card className="glass-card">
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kurs</TableHead>
                    <TableHead>Maßnahmen-Nr.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Lernform</TableHead>
                    <TableHead>Fachkundige Stelle</TableHead>
                    <TableHead>Gültig bis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {massnahmen?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Noch keine Maßnahmen beantragt
                      </TableCell>
                    </TableRow>
                  )}
                  {massnahmen?.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.courses?.title || '-'}</TableCell>
                      <TableCell className="font-mono text-sm">{m.massnahmen_nummer || '-'}</TableCell>
                      <TableCell>
                        <Badge className={zulassungStatusLabels[m.zulassung_status]?.color}>
                          {zulassungStatusLabels[m.zulassung_status]?.label || m.zulassung_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">{m.lernform || '-'}</TableCell>
                      <TableCell>{m.fachkundige_stelle || '-'}</TableCell>
                      <TableCell>
                        {m.zulassung_bis ? format(new Date(m.zulassung_bis), 'dd.MM.yyyy', { locale: de }) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="glass-card border-blue-500/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-500" />
                Voraussetzungen Maßnahmenzulassung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Für die Zulassung einer Maßnahme nach §179 SGB III müssen folgende Voraussetzungen erfüllt sein:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Gültige Trägerzulassung im entsprechenden Fachbereich</li>
                <li>Dokumentiertes Maßnahmenkonzept mit Lernzielen</li>
                <li>Curriculum/Rahmenlehrplan als Grundlage (frozen)</li>
                <li>Qualifiziertes Lehrpersonal mit Nachweisen</li>
                <li>Geeignete Räumlichkeiten/Lernumgebung</li>
                <li>Lernerfolgskontrollen (Mini-Checks, Prüfungen)</li>
                <li>Teilnehmerdokumentation und Nachweissystem</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer Info */}
      <Card className="glass-card bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="py-4">
          <div className="flex items-center gap-4 text-sm">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <span className="font-medium">Nächste Schritte zur AZAV-Zertifizierung:</span>
              <span className="text-muted-foreground ml-2">
                {complianceScore < 50 
                  ? 'Pflichtdokumente erstellen und genehmigen'
                  : complianceScore < 80 
                  ? 'Offene Anforderungen prüfen und umsetzen'
                  : 'Fachkundige Stelle für Audit kontaktieren (DEKRA, TÜV, Certqua)'
                }
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
