import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Upload, 
  FileText, 
  Sparkles, 
  CheckCircle, 
  Loader2,
  ArrowLeft,
  X
} from 'lucide-react';
import { Link } from 'react-router-dom';

type ImportStep = 'upload' | 'extracting' | 'review' | 'complete';

interface ExtractedData {
  title: string;
  description: string;
  version: string;
  learningFields: Array<{
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
  }>;
}

export default function CurriculumImport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<ImportStep>('upload');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [curriculumId, setCurriculumId] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) {
        toast({
          title: 'Datei zu groß',
          description: 'Die maximale Dateigröße beträgt 10 MB.',
          variant: 'destructive',
        });
        return;
      }
      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const removeFile = () => {
    setFile(null);
  };

  const handleUploadAndExtract = async () => {
    if (!file || !title.trim()) {
      toast({
        title: 'Fehlende Angaben',
        description: 'Bitte geben Sie einen Titel ein und wählen Sie eine Datei aus.',
        variant: 'destructive',
      });
      return;
    }

    setIsExtracting(true);
    setStep('extracting');
    setProgress(10);

    try {
      // 1. Upload file to storage
      const fileExt = file.name.split('.').pop();
      const filePath = `${user?.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('curriculum-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;
      setProgress(30);

      // 2. Create curriculum record
      const { data: curriculum, error: createError } = await supabase
        .from('curricula')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          source_file_name: file.name,
          source_file_url: filePath,
          status: 'extracting',
          created_by: user?.id,
        })
        .select()
        .single();

      if (createError) throw createError;
      setCurriculumId(curriculum.id);
      setProgress(50);

      // 3. Read file content for AI extraction
      const fileContent = await file.text();
      setProgress(60);

      // 4. Call AI extraction via Edge Function
      const { data: extractionResult, error: extractError } = await supabase.functions.invoke('extract-curriculum', {
        body: { 
          curriculumId: curriculum.id,
          fileContent: fileContent.substring(0, 50000), // Limit content size
          fileName: file.name,
        },
      });

      if (extractError) throw extractError;
      setProgress(90);

      // 5. Update curriculum with extracted data
      if (extractionResult?.extractedData) {
        setExtractedData(extractionResult.extractedData);
        
        await supabase
          .from('curricula')
          .update({
            extracted_data: extractionResult.extractedData,
            status: 'normalizing',
          })
          .eq('id', curriculum.id);
      }

      setProgress(100);
      setStep('review');

      toast({
        title: 'Extraktion erfolgreich',
        description: 'Die KI hat die Curriculum-Daten extrahiert. Bitte überprüfen Sie die Ergebnisse.',
      });

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Fehler beim Import',
        description: error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten.',
        variant: 'destructive',
      });
      setStep('upload');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFreeze = async () => {
    if (!curriculumId || !extractedData) return;

    try {
      // Insert learning fields and competencies
      for (let i = 0; i < extractedData.learningFields.length; i++) {
        const lf = extractedData.learningFields[i];
        
        const { data: learningField, error: lfError } = await supabase
          .from('learning_fields')
          .insert({
            curriculum_id: curriculumId,
            code: lf.code,
            title: lf.title,
            description: lf.description,
            hours: lf.hours,
            sort_order: i,
          })
          .select()
          .single();

        if (lfError) throw lfError;

        // Insert competencies for this learning field
        for (let j = 0; j < lf.competencies.length; j++) {
          const comp = lf.competencies[j];
          
          await supabase.from('competencies').insert({
            learning_field_id: learningField.id,
            code: comp.code,
            title: comp.title,
            description: comp.description,
            taxonomy_level: comp.taxonomyLevel,
            sort_order: j,
          });
        }
      }

      // Update curriculum status to frozen
      await supabase
        .from('curricula')
        .update({
          normalized_data: JSON.parse(JSON.stringify(extractedData)),
          status: 'frozen',
          frozen_at: new Date().toISOString(),
        })
        .eq('id', curriculumId);

      setStep('complete');
      toast({
        title: 'Curriculum eingefroren',
        description: 'Das Curriculum wurde erfolgreich als Single Source of Truth gespeichert.',
      });

    } catch (error) {
      console.error('Freeze error:', error);
      toast({
        title: 'Fehler beim Einfrieren',
        description: error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin-v2/curricula">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Curriculum importieren</h1>
          <p className="text-muted-foreground mt-1">Lade einen Rahmenlehrplan hoch und lasse ihn von der KI extrahieren</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {['upload', 'extracting', 'review', 'complete'].map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
              ${step === s ? 'gradient-primary text-primary-foreground' : 
                ['extracting', 'review', 'complete'].indexOf(step) > ['upload', 'extracting', 'review', 'complete'].indexOf(s) 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted text-muted-foreground'}
            `}>
              {i + 1}
            </div>
            {i < 3 && (
              <div className={`w-12 h-0.5 ${
                ['extracting', 'review', 'complete'].indexOf(step) > i ? 'bg-primary' : 'bg-muted'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Upload Step */}
      {step === 'upload' && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Datei hochladen
            </CardTitle>
            <CardDescription>
              Unterstützte Formate: PDF, DOCX, TXT
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Titel *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Fachinformatiker Anwendungsentwicklung 2024"
                className="bg-muted/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optionale Beschreibung des Curriculums..."
                className="bg-muted/50 min-h-[100px]"
              />
            </div>

            <div className="space-y-2">
              <Label>Datei *</Label>
              {file ? (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border">
                  <FileText className="h-8 w-8 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={removeFile}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-all">
                  <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-foreground font-medium">Datei auswählen</p>
                  <p className="text-sm text-muted-foreground">oder hierher ziehen</p>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <Button
              onClick={handleUploadAndExtract}
              disabled={!file || !title.trim()}
              className="w-full gradient-primary text-primary-foreground shadow-glow-sm"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Mit KI extrahieren
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Extracting Step */}
      {step === 'extracting' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <Sparkles className="h-16 w-16 text-primary mx-auto mb-6 animate-pulse" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              KI-Extraktion läuft...
            </h3>
            <p className="text-muted-foreground mb-6">
              Die KI analysiert das Curriculum und extrahiert Lernfelder und Kompetenzen.
            </p>
            <div className="max-w-md mx-auto">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground mt-2">{progress}%</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review Step */}
      {step === 'review' && extractedData && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Extrahierte Daten überprüfen
            </CardTitle>
            <CardDescription>
              Überprüfe die extrahierten Daten und friere das Curriculum ein.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4">
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-sm text-muted-foreground">Titel</p>
                <p className="font-medium text-foreground">{extractedData.title}</p>
              </div>
              
              {extractedData.description && (
                <div className="p-4 rounded-xl bg-muted/30">
                  <p className="text-sm text-muted-foreground">Beschreibung</p>
                  <p className="text-foreground">{extractedData.description}</p>
                </div>
              )}

              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-sm text-muted-foreground mb-3">
                  {extractedData.learningFields.length} Lernfelder
                </p>
                <div className="space-y-3">
                  {extractedData.learningFields.map((lf, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-background/50 border border-border/50">
                      <p className="font-medium text-foreground">
                        {lf.code}: {lf.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {lf.hours}h • {lf.competencies.length} Kompetenzen
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep('upload')}
                className="flex-1"
              >
                Zurück
              </Button>
              <Button
                onClick={handleFreeze}
                className="flex-1 gradient-primary text-primary-foreground shadow-glow-sm"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Einfrieren
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
            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              Curriculum erfolgreich importiert!
            </h3>
            <p className="text-muted-foreground mb-6">
              Das Curriculum wurde eingefroren und kann jetzt für Kurse verwendet werden.
            </p>
            <div className="flex gap-3 justify-center">
              <Link to="/admin-v2/curricula">
                <Button variant="outline">Zur Übersicht</Button>
              </Link>
              <Link to={`/admin-v2/courses/new?curriculumId=${curriculumId}`}>
                <Button className="gradient-primary text-primary-foreground">
                  Kurs erstellen
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
