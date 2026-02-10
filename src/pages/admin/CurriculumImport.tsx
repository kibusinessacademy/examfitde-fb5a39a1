import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { 
  Upload, FileText, Sparkles, CheckCircle, 
  ArrowLeft, X, Globe, Loader2
} from 'lucide-react';
import { Link } from 'react-router-dom';

type ImportStep = 'upload' | 'extracting' | 'review' | 'complete';
type SourceMode = 'file' | 'url';

interface ExtractedLF {
  code: string;
  title: string;
  description: string;
  hours: number;
  competencies: Array<{
    code: string;
    title: string;
    description: string;
    taxonomyLevel: string;
  }>;
}

interface ExtractedData {
  title: string;
  description: string;
  version: string;
  learningFields: ExtractedLF[];
}

interface ImportResult {
  success: boolean;
  curriculumId: string;
  counts: { learningFields: number; competencies: number };
  importLog: Array<{ step: string; ts: string; detail?: string }>;
  error?: string;
}

export default function CurriculumImport() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<ImportStep>('upload');
  const [sourceMode, setSourceMode] = useState<SourceMode>('file');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [curriculumId, setCurriculumId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) {
        toast({ title: 'Datei zu groß', description: 'Max. 10 MB.', variant: 'destructive' });
        return;
      }
      setFile(selectedFile);
      if (!title) setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleImport = async () => {
    if (!title.trim()) {
      toast({ title: 'Titel fehlt', variant: 'destructive' });
      return;
    }
    if (sourceMode === 'file' && !file) {
      toast({ title: 'Datei fehlt', variant: 'destructive' });
      return;
    }
    if (sourceMode === 'url' && !sourceUrl.trim()) {
      toast({ title: 'URL fehlt', variant: 'destructive' });
      return;
    }

    setStep('extracting');
    setProgress(10);

    try {
      // 1. Upload file to storage if file mode
      let storagePath: string | undefined;
      let fileContent: string | undefined;

      if (sourceMode === 'file' && file) {
        const ext = file.name.split('.').pop();
        storagePath = `${user?.id}/${Date.now()}.${ext}`;

        const { error: upErr } = await supabase.storage.from('curriculum-files').upload(storagePath, file);
        if (upErr) throw upErr;
        setProgress(20);

        // Also read text for direct extraction (works for .txt files)
        try {
          fileContent = await file.text();
          if (fileContent.length < 200) fileContent = undefined; // too short = probably binary
        } catch { /* ignore */ }
      }
      setProgress(30);

      // 2. Create curriculum record
      const { data: curriculum, error: createErr } = await supabase
        .from('curricula')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          source_file_name: file?.name || sourceUrl,
          source_file_url: storagePath || sourceUrl,
          status: 'draft' as any,
          created_by: user?.id,
          import_source: sourceMode === 'url' ? 'url' : 'upload',
        })
        .select()
        .single();

      if (createErr) throw createErr;
      setCurriculumId(curriculum.id);
      setProgress(40);

      // 3. Call curriculum-import edge function (server-side SSOT pipeline)
      const { data: result, error: importErr } = await supabase.functions.invoke('curriculum-import', {
        body: {
          action: 'import',
          curriculumId: curriculum.id,
          sourceUrl: sourceMode === 'url' ? sourceUrl : undefined,
          storagePath: sourceMode === 'file' ? storagePath : undefined,
          fileContent: fileContent?.substring(0, 80000),
        },
      });

      if (importErr) throw importErr;
      setProgress(90);

      if (result?.error) {
        throw new Error(result.error);
      }

      setImportResult(result);

      // Fetch the normalized data to show in review
      const { data: updated } = await supabase
        .from('curricula')
        .select('normalized_data, extracted_data')
        .eq('id', curriculum.id)
        .single();

      const data = (updated?.normalized_data || updated?.extracted_data) as unknown as ExtractedData | null;
      setExtractedData(data);
      setProgress(100);
      setStep(result?.success ? 'complete' : 'review');

      toast({
        title: result?.success ? 'Import erfolgreich!' : 'Extraktion abgeschlossen',
        description: result?.success
          ? `${result.counts.learningFields} Lernfelder, ${result.counts.competencies} Kompetenzen importiert und eingefroren.`
          : 'Bitte überprüfe die Ergebnisse.',
      });
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Fehler beim Import',
        description: error instanceof Error ? error.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
      setStep('upload');
    }
  };

  const totalComps = extractedData?.learningFields.reduce((s, lf) => s + lf.competencies.length, 0) || 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin-v2/curricula">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Curriculum importieren</h1>
          <p className="text-muted-foreground mt-1">Server-seitiger SSOT-Import via KI-Extraktion</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {(['upload', 'extracting', 'review', 'complete'] as const).map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === s ? 'gradient-primary text-primary-foreground' :
              ['upload', 'extracting', 'review', 'complete'].indexOf(step) > i
                ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>{i + 1}</div>
            {i < 3 && <div className={`w-12 h-0.5 ${['upload', 'extracting', 'review', 'complete'].indexOf(step) > i ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {/* Upload Step */}
      {step === 'upload' && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Quelle auswählen
            </CardTitle>
            <CardDescription>PDF-Upload oder URL zum Rahmenlehrplan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Source toggle */}
            <div className="flex gap-2">
              <Button variant={sourceMode === 'file' ? 'default' : 'outline'} onClick={() => setSourceMode('file')} className="flex-1">
                <FileText className="h-4 w-4 mr-2" /> Datei hochladen
              </Button>
              <Button variant={sourceMode === 'url' ? 'default' : 'outline'} onClick={() => setSourceMode('url')} className="flex-1">
                <Globe className="h-4 w-4 mr-2" /> URL eingeben
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Titel *</Label>
              <Input id="title" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="z.B. Fachinformatiker Anwendungsentwicklung 2024" className="bg-muted/50" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Optionale Beschreibung..." className="bg-muted/50 min-h-[80px]" />
            </div>

            {sourceMode === 'file' ? (
              <div className="space-y-2">
                <Label>Datei *</Label>
                {file ? (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border">
                    <FileText className="h-8 w-8 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{file.name}</p>
                      <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setFile(null)}><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-all">
                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-foreground font-medium">Datei auswählen</p>
                    <p className="text-sm text-muted-foreground">PDF, DOCX, TXT — max 10 MB</p>
                    <input type="file" accept=".pdf,.docx,.txt" onChange={handleFileChange} className="hidden" />
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="sourceUrl">Rahmenlehrplan-URL *</Label>
                <Input id="sourceUrl" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
                  placeholder="https://www.kmk.org/fileadmin/..." className="bg-muted/50" />
                <p className="text-xs text-muted-foreground">PDF-Link oder Webseite mit dem Rahmenlehrplan-Inhalt</p>
              </div>
            )}

            <Button onClick={handleImport}
              disabled={!title.trim() || (sourceMode === 'file' ? !file : !sourceUrl.trim())}
              className="w-full gradient-primary text-primary-foreground shadow-glow-sm">
              <Sparkles className="h-4 w-4 mr-2" />
              Server-seitig importieren & einfrieren
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Extracting Step */}
      {step === 'extracting' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <Loader2 className="h-16 w-16 text-primary mx-auto mb-6 animate-spin" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">Server-seitige Extraktion...</h3>
            <p className="text-muted-foreground mb-6">Firecrawl → LLM-Extraktion → Normalisierung → Upsert → Freeze</p>
            <div className="max-w-md mx-auto">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground mt-2">{progress}%</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review Step (only if not auto-frozen) */}
      {step === 'review' && extractedData && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Extrahierte Daten
            </CardTitle>
            <CardDescription>Review — manuelle Korrektur vor Freeze möglich</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ReviewContent data={extractedData} />
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('upload')} className="flex-1">Zurück</Button>
              <Button onClick={async () => {
                if (!curriculumId) return;
                const { data, error } = await supabase.functions.invoke('curriculum-import', {
                  body: { action: 'freeze', curriculumId },
                });
                if (error || data?.error) {
                  toast({ title: 'Fehler', description: data?.error || error?.message, variant: 'destructive' });
                } else {
                  setImportResult(data);
                  setStep('complete');
                  toast({ title: 'Eingefroren!', description: `${data.counts.learningFields} LFs, ${data.counts.competencies} Kompetenzen` });
                }
              }} className="flex-1 gradient-primary text-primary-foreground shadow-glow-sm">
                <CheckCircle className="h-4 w-4 mr-2" /> Einfrieren
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Complete Step */}
      {step === 'complete' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center mx-auto mb-6 shadow-glow">
              <CheckCircle className="h-10 w-10 text-primary-foreground" />
            </div>
            <h3 className="text-xl font-display font-bold text-foreground mb-2">Curriculum importiert & eingefroren!</h3>
            {importResult?.counts && (
              <p className="text-muted-foreground mb-2">
                {importResult.counts.learningFields} Lernfelder · {importResult.counts.competencies} Kompetenzen
              </p>
            )}
            {extractedData && <ReviewContent data={extractedData} />}
            <div className="flex gap-3 justify-center mt-6">
              <Link to="/admin-v2/curricula"><Button variant="outline">Zur Übersicht</Button></Link>
              <Link to={`/admin-v2/courses/new?curriculumId=${curriculumId}`}>
                <Button className="gradient-primary text-primary-foreground">Kurs erstellen</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReviewContent({ data }: { data: ExtractedData }) {
  const totalComps = data.learningFields.reduce((s, lf) => s + lf.competencies.length, 0);
  return (
    <div className="grid gap-4 text-left">
      <div className="p-4 rounded-xl bg-muted/30">
        <p className="text-sm text-muted-foreground">Titel</p>
        <p className="font-medium text-foreground">{data.title}</p>
      </div>
      {data.description && (
        <div className="p-4 rounded-xl bg-muted/30">
          <p className="text-sm text-muted-foreground">Beschreibung</p>
          <p className="text-foreground text-sm">{data.description}</p>
        </div>
      )}
      <div className="p-4 rounded-xl bg-muted/30">
        <p className="text-sm text-muted-foreground mb-3">
          {data.learningFields.length} Lernfelder · {totalComps} Kompetenzen
        </p>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {data.learningFields.map((lf, idx) => (
            <div key={idx} className="p-3 rounded-lg bg-background/50 border border-border/50">
              <p className="font-medium text-foreground text-sm">{lf.code}: {lf.title}</p>
              <p className="text-xs text-muted-foreground">{lf.hours > 0 ? `${lf.hours}h · ` : ''}{lf.competencies.length} Kompetenzen</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
