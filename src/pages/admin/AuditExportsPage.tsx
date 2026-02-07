import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileJson2, 
  Download, 
  Loader2, 
  Shield, 
  Users, 
  BookOpen, 
  FileCheck,
  AlertCircle,
  CheckCircle2,
  Archive,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AuditExportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedAttempt, setSelectedAttempt] = useState<string>('');
  const [includeRawLogs, setIncludeRawLogs] = useState(false);
  const [useRpcExport, setUseRpcExport] = useState(true);
  const [pseudonymize, setPseudonymize] = useState(true);
  const [verifyingPackId, setVerifyingPackId] = useState<string | null>(null);
  const [useStorageFirst, setUseStorageFirst] = useState(true); // Storage-first mode

  // Fetch courses
  const { data: courses } = useQuery({
    queryKey: ['admin-courses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('courses')
        .select('id, title, status, curriculum_id')
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  // Fetch enrollments for selected course
  const { data: enrollments } = useQuery({
    queryKey: ['course-enrollments', selectedCourse],
    queryFn: async () => {
      if (!selectedCourse) return [];
      const { data, error } = await supabase
        .from('course_enrollments')
        .select(`
          user_id,
          enrolled_at,
          completed_at,
          profiles!inner (full_name, email)
        `)
        .eq('course_id', selectedCourse);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCourse,
  });

  // Fetch exam attempts
  const { data: attempts } = useQuery({
    queryKey: ['exam-attempts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_sessions')
        .select(`
          id,
          user_id,
          started_at,
          finished_at,
          mode,
          passed,
          score_percentage,
          curricula (title)
        `)
        .not('finished_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Fetch AI tutor stats
  const { data: tutorStats } = useQuery({
    queryKey: ['tutor-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_tutor_logs')
        .select('mode, was_blocked')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      
      const stats = {
        total: data.length,
        learning: data.filter(l => l.mode === 'learning').length,
        practice: data.filter(l => l.mode === 'practice').length,
        exam: data.filter(l => l.mode === 'exam').length,
        blocked: data.filter(l => l.was_blocked).length,
      };
      return stats;
    },
  });

  // Fetch archived evidence packs
  const { data: evidencePacks, isLoading: packsLoading } = useQuery({
    queryKey: ['evidence-packs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_evidence_packs')
        .select(`
          id,
          course_id,
          curriculum_id,
          generated_at,
          generated_by,
          fingerprint_sha256,
          export_version,
          is_immutable,
          storage_bucket,
          storage_path,
          size_bytes,
          notes,
          pack,
          courses (title),
          curricula (title)
        `)
        .order('generated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Archive pack mutation - supports both inline and storage-first
  const archivePackMutation = useMutation({
    mutationFn: async (courseId: string) => {
      if (useStorageFirst) {
        // Storage-first via edge function
        const { data, error } = await supabase.functions.invoke('generate-evidence-pack', {
          body: { 
            courseId, 
            includeQuestions: includeRawLogs,
            includeH5p: true 
          }
        });
        if (error) throw error;
        return { ...data, mode: 'storage' };
      } else {
        // Inline via RPC
        const { data, error } = await supabase.rpc('create_course_evidence_pack', {
          p_course_id: courseId,
          p_include_questions: includeRawLogs,
          p_include_h5p: true,
          p_store_inline: true,
          p_notes: null
        });
        if (error) throw error;
        return { ...(data as object), mode: 'inline' };
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['evidence-packs'] });
      
      if (data.mode === 'storage' && data.signed_url) {
        toast({
          title: 'Evidence Pack erstellt',
          description: `Fingerprint: ${data.fingerprint_sha256?.substring(0, 16)}... (${(data.size_bytes / 1024).toFixed(1)} KB)`,
        });
        // Auto-download
        window.open(data.signed_url, '_blank');
      } else {
        toast({
          title: data.status === 'existing' ? 'Pack existiert bereits' : 'Pack archiviert',
          description: `Fingerprint: ${(data.fingerprint || data.fingerprint_sha256)?.substring(0, 16)}...`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Archivierung fehlgeschlagen',
        description: error instanceof Error ? error.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    },
  });

  // Verify pack integrity
  const handleVerifyPack = async (packId: string) => {
    setVerifyingPackId(packId);
    try {
      const { data, error } = await supabase.rpc('verify_evidence_pack_integrity', {
        p_pack_id: packId
      });
      if (error) throw error;
      
      const result = data as any;
      toast({
        title: result.integrity_ok ? '✓ Integrität bestätigt' : '⚠ Manipulation erkannt!',
        description: result.integrity_ok 
          ? `Fingerprint verifiziert: ${result.stored_fingerprint?.substring(0, 16)}...`
          : 'Der gespeicherte Pack wurde verändert!',
        variant: result.integrity_ok ? 'default' : 'destructive',
      });
    } catch (error) {
      toast({
        title: 'Verifizierung fehlgeschlagen',
        description: error instanceof Error ? error.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setVerifyingPackId(null);
    }
  };

  // Download archived pack - supports both inline and storage
  const handleDownloadPack = async (packId: string, hasInlinePack: boolean, storagePath: string | null) => {
    try {
      if (hasInlinePack) {
        // Inline pack - use RPC
        const { data, error } = await supabase.rpc('get_evidence_pack', {
          p_pack_id: packId
        });
        if (error) throw error;
        
        const packData = data as any;
        if (!packData.pack) {
          toast({
            title: 'Kein Inline-Pack',
            description: 'Pack ist extern gespeichert',
            variant: 'destructive',
          });
          return;
        }

        const blob = new Blob([JSON.stringify(packData.pack, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `evidence-pack-${packData.fingerprint?.substring(0, 8)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (storagePath) {
        // Storage pack - get signed URL via edge function
        const { data, error } = await supabase.functions.invoke('get-evidence-pack-url', {
          body: { packId }
        });
        if (error) throw error;
        
        if (data?.signed_url) {
          window.open(data.signed_url, '_blank');
        } else {
          throw new Error('No signed URL returned');
        }
      } else {
        toast({
          title: 'Download nicht möglich',
          description: 'Pack hat weder Inline-Daten noch Storage-Pfad',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Download fehlgeschlagen',
        description: error instanceof Error ? error.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    }
  };

  const handleExport = async (type: 'participant' | 'course' | 'attempt') => {
    setIsExporting(true);
    try {
      let body: any = { 
        type, 
        include_raw_logs: includeRawLogs,
        use_rpc: type === 'participant' ? useRpcExport : undefined,
        pseudonymize: type === 'participant' ? pseudonymize : undefined
      };
      
      if (type === 'participant') {
        if (!selectedCourse || !selectedUser) {
          toast({ title: 'Fehler', description: 'Bitte Kurs und Teilnehmer auswählen', variant: 'destructive' });
          return;
        }
        body.course_id = selectedCourse;
        body.user_id = selectedUser;
      } else if (type === 'course') {
        if (!selectedCourse) {
          toast({ title: 'Fehler', description: 'Bitte Kurs auswählen', variant: 'destructive' });
          return;
        }
        body.course_id = selectedCourse;
        body.use_rpc = useRpcExport;
      } else if (type === 'attempt') {
        if (!selectedAttempt) {
          toast({ title: 'Fehler', description: 'Bitte Prüfungsversuch auswählen', variant: 'destructive' });
          return;
        }
        body.attempt_id = selectedAttempt;
      }

      const { data, error } = await supabase.functions.invoke('audit-export', { body });

      if (error) throw error;

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `azav-export-${type}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ 
        title: 'Export erfolgreich', 
        description: `AZAV Evidence Pack wurde heruntergeladen` 
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({ 
        title: 'Export fehlgeschlagen', 
        description: error instanceof Error ? error.message : 'Unbekannter Fehler',
        variant: 'destructive' 
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">AZAV & Audit Exports</h1>
        <p className="text-muted-foreground">
          Behörden-konforme Nachweise exportieren
        </p>
      </div>

      {/* Governance Status */}
      <Card className="glass-card border-green-500/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-500" />
            <CardTitle>Governance Status</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">Server-Side Enforcement</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">Exam-Mode KI deaktiviert</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">Audit-Logging aktiv</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">RLS-geschützt</span>
            </div>
          </div>
          
          {tutorStats && (
            <div className="mt-4 pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">AI-Tutor Statistiken (letzte 1000 Interaktionen)</h4>
              <div className="grid grid-cols-5 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Gesamt</div>
                  <div className="font-medium">{tutorStats.total}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Learning</div>
                  <div className="font-medium text-green-600">{tutorStats.learning}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Practice</div>
                  <div className="font-medium text-yellow-600">{tutorStats.practice}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Exam</div>
                  <div className="font-medium text-red-600">{tutorStats.exam}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Blockiert</div>
                  <div className="font-medium text-red-600">{tutorStats.blocked}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export Options */}
      <Tabs defaultValue="participant" className="space-y-4">
        <TabsList>
          <TabsTrigger value="participant" className="gap-2">
            <Users className="h-4 w-4" />
            Teilnehmerakte
          </TabsTrigger>
          <TabsTrigger value="course" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Kursakte
          </TabsTrigger>
          <TabsTrigger value="attempt" className="gap-2">
            <FileCheck className="h-4 w-4" />
            Prüfungsprotokoll
          </TabsTrigger>
          <TabsTrigger value="archive" className="gap-2">
            <Archive className="h-4 w-4" />
            Archiv
          </TabsTrigger>
        </TabsList>

        <TabsContent value="participant">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Teilnehmerakte exportieren</CardTitle>
              <CardDescription>
                Vollständige Lernhistorie eines Teilnehmers für einen Kurs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kurs auswählen</Label>
                  <Select value={selectedCourse} onValueChange={setSelectedCourse}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kurs wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {courses?.map(course => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.title}
                          <Badge variant="outline" className="ml-2 text-xs">
                            {course.status}
                          </Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Teilnehmer auswählen</Label>
                  <Select 
                    value={selectedUser} 
                    onValueChange={setSelectedUser}
                    disabled={!selectedCourse}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Teilnehmer wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {enrollments?.map((e: any) => (
                        <SelectItem key={e.user_id} value={e.user_id}>
                          {e.profiles?.full_name || e.profiles?.email || e.user_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="use-rpc" 
                    checked={useRpcExport}
                    onCheckedChange={setUseRpcExport}
                  />
                  <Label htmlFor="use-rpc">
                    Datenbank-Funktion verwenden (empfohlen für AZAV)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch 
                    id="pseudonymize" 
                    checked={pseudonymize}
                    onCheckedChange={setPseudonymize}
                  />
                  <Label htmlFor="pseudonymize">
                    Pseudonymisierung aktivieren (DSGVO)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch 
                    id="raw-logs" 
                    checked={includeRawLogs}
                    onCheckedChange={setIncludeRawLogs}
                  />
                  <Label htmlFor="raw-logs">Detaillierte AI-Tutor Logs einschließen</Label>
                </div>
              </div>

              <Button 
                onClick={() => handleExport('participant')}
                disabled={isExporting || !selectedCourse || !selectedUser}
                className="w-full"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Teilnehmerakte exportieren
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="course">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Kursakte exportieren</CardTitle>
              <CardDescription>
                Kursstruktur, Curriculum-Status und aggregierte Statistiken
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Kurs auswählen</Label>
                  <Select value={selectedCourse} onValueChange={setSelectedCourse}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kurs wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {courses?.map(course => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.title}
                          <Badge variant="outline" className="ml-2 text-xs">
                            {course.status}
                          </Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4 pt-2 border-t">
                  <div className="flex items-center space-x-2">
                    <Switch 
                      id="use-rpc-course" 
                      checked={useRpcExport}
                      onCheckedChange={setUseRpcExport}
                    />
                    <Label htmlFor="use-rpc-course">
                      Datenbank-Funktion verwenden (empfohlen für AZAV)
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch 
                      id="include-questions" 
                      checked={includeRawLogs}
                      onCheckedChange={setIncludeRawLogs}
                    />
                    <Label htmlFor="include-questions">Prüfungsfragen-Details einschließen</Label>
                  </div>
                </div>

                <Button 
                  onClick={() => handleExport('course')}
                  disabled={isExporting || !selectedCourse}
                  className="w-full"
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Kursakte exportieren
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attempt">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Prüfungsprotokoll exportieren</CardTitle>
              <CardDescription>
                Detailliertes Protokoll eines einzelnen Prüfungsversuchs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Prüfungsversuch auswählen</Label>
                <Select value={selectedAttempt} onValueChange={setSelectedAttempt}>
                  <SelectTrigger>
                    <SelectValue placeholder="Versuch wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {attempts?.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {new Date(a.started_at).toLocaleDateString('de-DE')} - 
                        {a.curricula?.title} - 
                        {a.score_percentage?.toFixed(0)}%
                        {a.passed && <Badge className="ml-2 text-xs bg-green-500">Bestanden</Badge>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Switch 
                  id="raw-logs-attempt" 
                  checked={includeRawLogs}
                  onCheckedChange={setIncludeRawLogs}
                />
                <Label htmlFor="raw-logs-attempt">Detaillierte AI-Tutor Logs einschließen</Label>
              </div>

              <Button 
                onClick={() => handleExport('attempt')}
                disabled={isExporting || !selectedAttempt}
                className="w-full"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Prüfungsprotokoll exportieren
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 9C: Evidence Pack Archive */}
        <TabsContent value="archive">
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Archive className="h-5 w-5" />
                    Evidence Pack Archiv
                  </CardTitle>
                  <CardDescription>
                    Immutable, fingerprint-gesicherte Kurs-Snapshots für AZAV-Nachweis
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['evidence-packs'] })}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Aktualisieren
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Archive new pack */}
              <div className="flex items-end gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex-1 space-y-2">
                  <Label>Kurs archivieren</Label>
                  <Select value={selectedCourse} onValueChange={setSelectedCourse}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kurs wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {courses?.map(course => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.title}
                          <Badge variant="outline" className="ml-2 text-xs">
                            {course.status}
                          </Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="storage-first" 
                    checked={useStorageFirst}
                    onCheckedChange={setUseStorageFirst}
                  />
                  <Label htmlFor="storage-first" className="text-sm">
                    Storage
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="include-questions-archive" 
                    checked={includeRawLogs}
                    onCheckedChange={setIncludeRawLogs}
                  />
                  <Label htmlFor="include-questions-archive" className="text-sm">
                    Fragen inkl.
                  </Label>
                </div>
                <Button
                  onClick={() => selectedCourse && archivePackMutation.mutate(selectedCourse)}
                  disabled={!selectedCourse || archivePackMutation.isPending}
                >
                  {archivePackMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Archive className="h-4 w-4 mr-2" />
                  )}
                  {useStorageFirst ? 'Storage-Pack' : 'Inline-Pack'}
                </Button>
              </div>

              {/* Archived packs table */}
              {packsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : evidencePacks && evidencePacks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kurs</TableHead>
                      <TableHead>Curriculum</TableHead>
                      <TableHead>Erstellt</TableHead>
                      <TableHead>Fingerprint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evidencePacks.map((pack: any) => (
                      <TableRow key={pack.id}>
                        <TableCell className="font-medium">
                          {pack.courses?.title || pack.course_id.substring(0, 8)}
                        </TableCell>
                        <TableCell>
                          {pack.curricula?.title || pack.curriculum_id.substring(0, 8)}
                        </TableCell>
                        <TableCell>
                          {new Date(pack.generated_at).toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {pack.fingerprint_sha256?.substring(0, 12)}...
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {pack.is_immutable ? (
                              <Badge variant="outline" className="text-green-600 border-green-600 w-fit">
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Immutable
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="w-fit">Mutable</Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {pack.storage_path ? 'Storage' : 'Inline'}
                              {pack.size_bytes && ` • ${(pack.size_bytes / 1024).toFixed(1)} KB`}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleVerifyPack(pack.id)}
                              disabled={verifyingPackId === pack.id}
                            >
                              {verifyingPackId === pack.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldCheck className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDownloadPack(
                                pack.id, 
                                pack.pack !== null, 
                                pack.storage_path
                              )}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Archive className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Noch keine Evidence Packs archiviert</p>
                  <p className="text-sm">Wählen Sie einen Kurs und klicken Sie auf "Archivieren"</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Recent Attempts Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Letzte Prüfungsversuche</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Curriculum</TableHead>
                <TableHead>Modus</TableHead>
                <TableHead>Ergebnis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts?.slice(0, 10).map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {new Date(a.started_at).toLocaleDateString('de-DE')}
                  </TableCell>
                  <TableCell>{a.curricula?.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{a.mode}</Badge>
                  </TableCell>
                  <TableCell>
                    {a.score_percentage?.toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    {a.passed ? (
                      <Badge className="bg-green-500">Bestanden</Badge>
                    ) : (
                      <Badge variant="destructive">Nicht bestanden</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedAttempt(a.id);
                        handleExport('attempt');
                      }}
                    >
                      <FileJson2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
