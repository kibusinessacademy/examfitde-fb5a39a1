import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Download, 
  Play, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  Database,
  FileText,
  Building2,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

interface SeedingStats {
  berufe: number;
  dokumente: number;
  missingDqr: number;
  missingRlp: number;
  completeness: {
    dqr: number;
    rahmenlehrplan: number;
  };
}

interface BerufItem {
  bibbId: string;
  profilUrl: string;
}

interface SeedingLog {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export default function BIBBSeedingPage() {
  const [stats, setStats] = useState<SeedingStats>({ 
    berufe: 0, 
    dokumente: 0,
    missingDqr: 0,
    missingRlp: 0,
    completeness: { dqr: 0, rahmenlehrplan: 0 }
  });
  const [loading, setLoading] = useState(false);
  const [scanningList, setScanningList] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [seedingProgress, setSeedingProgress] = useState(0);
  const [pendingBerufe, setPendingBerufe] = useState<BerufItem[]>([]);
  const [currentBeruf, setCurrentBeruf] = useState<string | null>(null);
  const [logs, setLogs] = useState<SeedingLog[]>([]);
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message, type }]);
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('bibb-seeding', {
        body: { action: 'status' },
      });

      if (error) throw error;
      setStats(data.stats || { 
        berufe: 0, 
        dokumente: 0,
        missingDqr: 0,
        missingRlp: 0,
        completeness: { dqr: 0, rahmenlehrplan: 0 }
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Fehler beim Laden der Statistiken');
    } finally {
      setLoading(false);
    }
  };

  const enrichMissingData = async () => {
    setEnriching(true);
    addLog('Starte Anreicherung fehlender Daten (DQR-Niveau, Rahmenlehrpläne)...', 'info');

    try {
      const { data, error } = await supabase.functions.invoke('bibb-seeding', {
        body: { action: 'enrich_missing', limit: 50 },
      });

      if (error) throw error;

      addLog(`${data.processed} Berufe verarbeitet`, 'success');
      
      for (const result of data.results || []) {
        if (result.status === 'enriched') {
          const updates = Object.keys(result.updates).filter(k => k !== 'updated_at').join(', ');
          addLog(`✓ ${result.bibbId}: ${updates}`, 'success');
        } else if (result.status === 'fallback_used') {
          addLog(`~ ${result.bibbId}: Fallback-Werte verwendet`, 'info');
        }
      }

      toast.success(`${data.processed} Berufe angereichert`);
      fetchStats();
    } catch (error: any) {
      addLog(`Fehler: ${error.message}`, 'error');
      toast.error('Fehler beim Anreichern');
    } finally {
      setEnriching(false);
    }
  };

  const scanBerufeListe = async () => {
    setScanningList(true);
    addLog('Scanne BIBB-Verzeichnis nach Berufen...', 'info');
    
    try {
      const { data, error } = await supabase.functions.invoke('bibb-seeding', {
        body: { action: 'scrape_all' },
      });

      if (error) throw error;

      addLog(`${data.totalFound} Berufe im BIBB-Verzeichnis gefunden`, 'success');
      addLog(`${data.alreadyImported} bereits importiert`, 'info');
      addLog(`${data.pendingImport} noch zu importieren`, 'info');

      setPendingBerufe(data.bibbIds.map((id: string) => ({ bibbId: id, profilUrl: '' })));
      
      toast.success(`${data.totalFound} Berufe gefunden, ${data.pendingImport} neu`);
    } catch (error: any) {
      console.error('Error scanning:', error);
      addLog(`Fehler beim Scannen: ${error.message}`, 'error');
      toast.error('Fehler beim Scannen');
    } finally {
      setScanningList(false);
    }
  };

  const startSeeding = async () => {
    if (pendingBerufe.length === 0) {
      toast.error('Keine ausstehenden Berufe. Bitte zuerst scannen.');
      return;
    }

    setIsSeeding(true);
    setSeedingProgress(0);
    addLog(`Starte Seeding für ${pendingBerufe.length} Berufe...`, 'info');

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < pendingBerufe.length; i++) {
      const beruf = pendingBerufe[i];
      setCurrentBeruf(beruf.bibbId);
      setSeedingProgress(Math.round((i / pendingBerufe.length) * 100));

      try {
        const { data, error } = await supabase.functions.invoke('bibb-seeding', {
          body: { action: 'scrape_beruf', bibbId: beruf.bibbId },
        });

        if (error) throw error;

        addLog(`✓ ${data.beruf.bezeichnung_kurz} importiert (${data.dokumenteCount} Dokumente)`, 'success');
        successCount++;
      } catch (error: any) {
        addLog(`✗ Fehler bei ${beruf.bibbId}: ${error.message}`, 'error');
        errorCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    setSeedingProgress(100);
    setCurrentBeruf(null);
    setIsSeeding(false);
    
    addLog(`Seeding abgeschlossen: ${successCount} erfolgreich, ${errorCount} Fehler`, successCount > 0 ? 'success' : 'error');
    toast.success(`Seeding abgeschlossen: ${successCount} Berufe importiert`);
    
    fetchStats();
    setPendingBerufe([]);
  };

  const seedSingleBeruf = async (bibbId: string) => {
    setCurrentBeruf(bibbId);
    addLog(`Importiere ${bibbId}...`, 'info');

    try {
      const { data, error } = await supabase.functions.invoke('bibb-seeding', {
        body: { action: 'scrape_beruf', bibbId },
      });

      if (error) throw error;

      addLog(`✓ ${data.beruf.bezeichnung_kurz} importiert (${data.dokumenteCount} Dokumente)`, 'success');
      toast.success(`${data.beruf.bezeichnung_kurz} erfolgreich importiert`);
      fetchStats();
    } catch (error: any) {
      addLog(`✗ Fehler: ${error.message}`, 'error');
      toast.error(`Fehler beim Importieren: ${error.message}`);
    } finally {
      setCurrentBeruf(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">BIBB Seeding</h1>
          <p className="text-muted-foreground mt-1">
            Importiere alle anerkannten Ausbildungsberufe aus dem BIBB-Verzeichnis
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={fetchStats} 
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Aktualisieren
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Importierte Berufe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Building2 className="h-8 w-8 text-primary" />
              <span className="text-3xl font-bold">{stats.berufe}</span>
              <span className="text-muted-foreground">/ ~327</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Berufsdokumente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <FileText className="h-8 w-8 text-primary" />
              <span className="text-3xl font-bold">{stats.dokumente}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              DQR-Niveau
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-primary">{stats.completeness?.dqr || 0}%</span>
                <span className="text-xs text-muted-foreground">{stats.missingDqr} fehlen</span>
              </div>
              <Progress value={stats.completeness?.dqr || 0} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Rahmenlehrpläne
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-primary">{stats.completeness?.rahmenlehrplan || 0}%</span>
                <span className="text-xs text-muted-foreground">{stats.missingRlp} fehlen</span>
              </div>
              <Progress value={stats.completeness?.rahmenlehrplan || 0} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ausstehend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Database className="h-8 w-8 text-primary" />
              <span className="text-3xl font-bold">{pendingBerufe.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Seeding-Aktionen</CardTitle>
          <CardDescription>
            Schritt 1: Scanne das BIBB-Verzeichnis. Schritt 2: Importiere alle Berufe. Schritt 3: Reichere fehlende Daten an.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={scanBerufeListe}
              disabled={scanningList || isSeeding || enriching}
              variant="outline"
            >
              {scanningList ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              BIBB-Verzeichnis scannen
            </Button>

            <Button
              onClick={startSeeding}
              disabled={isSeeding || pendingBerufe.length === 0 || enriching}
              className="gradient-primary text-primary-foreground"
            >
              {isSeeding ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Seeding starten ({pendingBerufe.length})
            </Button>

            <Button
              onClick={enrichMissingData}
              disabled={enriching || isSeeding || (stats.missingDqr === 0 && stats.missingRlp === 0)}
              variant="secondary"
            >
              {enriching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Daten anreichern ({stats.missingDqr + stats.missingRlp})
            </Button>
          </div>

          {isSeeding && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Aktuell: {currentBeruf || '...'}
                </span>
                <span className="font-medium">{seedingProgress}%</span>
              </div>
              <Progress value={seedingProgress} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Import */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Einzelberuf importieren</CardTitle>
          <CardDescription>
            Importiere einen spezifischen Beruf anhand seiner BIBB-ID
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              type="text"
              id="bibbIdInput"
              placeholder="z.B. rtretgf (Digitalisierungsmanagement)"
              className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm"
            />
            <Button
              onClick={() => {
                const input = document.getElementById('bibbIdInput') as HTMLInputElement;
                if (input.value.trim()) {
                  seedSingleBeruf(input.value.trim());
                }
              }}
              disabled={currentBeruf !== null}
            >
              {currentBeruf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Beispiel-IDs: rtretgf (Digitalisierungsmanagement), 80000 (Fachinformatiker), indust24 (Industriekaufmann)
          </p>
        </CardContent>
      </Card>

      {/* Logs */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Seeding-Log</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px] w-full rounded-md border p-4">
            {logs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Noch keine Aktivitäten. Starte das Seeding, um Logs zu sehen.
              </p>
            ) : (
              <div className="space-y-2">
                {logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {log.type === 'success' && <CheckCircle className="h-4 w-4 text-primary mt-0.5" />}
                    {log.type === 'error' && <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />}
                    {log.type === 'info' && <RefreshCw className="h-4 w-4 text-muted-foreground mt-0.5" />}
                    <span className="text-muted-foreground font-mono text-xs">
                      {new Date(log.timestamp).toLocaleTimeString('de-DE')}
                    </span>
                    <span className={log.type === 'error' ? 'text-destructive' : ''}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
