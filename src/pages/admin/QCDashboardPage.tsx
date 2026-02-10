import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield, Send, Download, Loader2, BookOpen, FileQuestion,
  Bot, Mic, BookMarked, Layers, AlertTriangle, CheckCircle2, Copy
} from "lucide-react";

type SnapshotAction = "course" | "exam_trainer" | "ai_tutor" | "oral_exam" | "handbook" | "full_audit";

const ACTION_META: Record<SnapshotAction, { label: string; icon: any; desc: string; needsCourse: boolean }> = {
  course: { label: "Kurs", icon: BookOpen, desc: "Module, Lessons, MiniChecks, Audits", needsCourse: true },
  exam_trainer: { label: "Prüfungstrainer", icon: FileQuestion, desc: "Fragen, Blueprints, Schwierigkeitsverteilung", needsCourse: false },
  ai_tutor: { label: "AI-Tutor", icon: Bot, desc: "Session-Statistiken, Governance, Blockierungen", needsCourse: false },
  oral_exam: { label: "Mündliche Prüfung", icon: Mic, desc: "Szenarien, Bewertungskriterien", needsCourse: false },
  handbook: { label: "Handbuch", icon: BookMarked, desc: "Kapitel, Übungen, Struktur", needsCourse: false },
  full_audit: { label: "Komplett-Audit", icon: Layers, desc: "Alle Bereiche kombiniert", needsCourse: true },
};

const AI_PROVIDERS = [
  { id: "lovable", label: "Lovable AI (Gemini)", model: "google/gemini-3-flash-preview" },
  { id: "openai", label: "OpenAI GPT-5.2", model: "openai/gpt-5.2" },
  { id: "anthropic", label: "Claude Opus", model: "claude" },
] as const;

export default function QCDashboardPage() {
  const { toast } = useToast();
  const [selectedAction, setSelectedAction] = useState<SnapshotAction>("course");
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState<string>("lovable");
  const [snapshot, setSnapshot] = useState<any>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  // Fetch courses for selector
  const { data: courses } = useQuery({
    queryKey: ["admin-courses-qc"],
    queryFn: async () => {
      const { data } = await supabase.from("courses").select("id, title, status").order("title");
      return data || [];
    },
  });

  const fetchSnapshot = async () => {
    setIsLoadingSnapshot(true);
    setSnapshot(null);
    setAiAnalysis("");
    try {
      const body: any = { action: selectedAction };
      if (selectedCourseId) body.courseId = selectedCourseId;

      const { data, error } = await supabase.functions.invoke("qc-snapshot", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSnapshot(data);
      toast({ title: "Snapshot erstellt", description: `${ACTION_META[selectedAction].label} Snapshot erfolgreich generiert.` });
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

  const runAIAnalysis = async () => {
    if (!snapshot) return;
    setIsAnalyzing(true);
    setAiAnalysis("");

    const systemPrompt = `Du bist ein erfahrener Qualitätsprüfer für IHK-Prüfungsvorbereitungskurse. 
Analysiere den folgenden Snapshot und erstelle einen strukturierten Qualitätsbericht:

1. **Gesamtbewertung** (Score 0-100, Note A-F)
2. **Stärken** (Top 5)
3. **Kritische Mängel** (Priorisiert nach Schwere)
4. **Vollständigkeit** (fehlende Inhalte, Steps, MiniChecks)
5. **Didaktische Qualität** (Lernziele, Progression, Praxisbezug)
6. **IHK-Prüfungsrelevanz** (Gewichtungen, Prüfungsblöcke)
7. **Konkrete Verbesserungsvorschläge** (als JSON-Patches wenn möglich)

Antworte auf Deutsch. Sei kritisch aber konstruktiv.`;

    const userPrompt = customPrompt 
      ? `${customPrompt}\n\nSnapshot:\n${JSON.stringify(snapshot, null, 2)}`
      : `Analysiere diesen QC-Snapshot:\n\n${JSON.stringify(snapshot, null, 2)}`;

    try {
      const provider = AI_PROVIDERS.find(p => p.id === selectedProvider);
      
      if (selectedProvider === "lovable") {
        // Use Lovable AI via edge function
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qc-ai-analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            systemPrompt,
            userPrompt,
            provider: selectedProvider,
            model: provider?.model,
          }),
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`AI analysis failed: ${errText}`);
        }
        // Stream response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                result += content;
                setAiAnalysis(result);
              }
            } catch { /* partial */ }
          }
        }
      }
    } catch (e: any) {
      toast({ title: "AI-Analyse fehlgeschlagen", description: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copySnapshot = () => {
    if (snapshot) {
      navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      toast({ title: "Kopiert", description: "Snapshot in Zwischenablage kopiert." });
    }
  };

  const downloadSnapshot = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qc-snapshot-${selectedAction}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionMeta = ACTION_META[selectedAction];
  const needsCourse = actionMeta.needsCourse || selectedAction === "exam_trainer" || selectedAction === "oral_exam";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            QC Snapshot API
          </h1>
          <p className="text-muted-foreground mt-1">
            SSOT-konforme Snapshots für externe AI-Qualitätskontrolle
          </p>
        </div>
      </div>

      {/* Action Selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {(Object.entries(ACTION_META) as [SnapshotAction, typeof ACTION_META[SnapshotAction]][]).map(([key, meta]) => {
          const Icon = meta.icon;
          return (
            <button
              key={key}
              onClick={() => setSelectedAction(key)}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedAction === key
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              <Icon className="h-5 w-5 mb-2 text-primary" />
              <div className="font-medium text-sm">{meta.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{meta.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Config Row */}
      <Card className="glass-card">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            {needsCourse && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1.5 block">Kurs</label>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                  <SelectTrigger><SelectValue placeholder="Kurs wählen…" /></SelectTrigger>
                  <SelectContent>
                    {(courses || []).map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                        <Badge variant="outline" className="ml-2 text-xs">{c.status}</Badge>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="min-w-[200px]">
              <label className="text-sm font-medium mb-1.5 block">AI Provider</label>
              <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={fetchSnapshot} disabled={isLoadingSnapshot || (needsCourse && !selectedCourseId)}>
              {isLoadingSnapshot ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Snapshot erstellen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {snapshot && (
        <Tabs defaultValue="snapshot" className="space-y-4">
          <TabsList>
            <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
            <TabsTrigger value="analysis">AI-Analyse</TabsTrigger>
          </TabsList>

          <TabsContent value="snapshot">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {actionMeta.label} Snapshot
                    </CardTitle>
                    <CardDescription>
                      Generiert: {snapshot.generatedAt}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={copySnapshot}>
                      <Copy className="h-4 w-4 mr-1" /> Kopieren
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadSnapshot}>
                      <Download className="h-4 w-4 mr-1" /> JSON
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Quick stats */}
                {snapshot.course?.stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {Object.entries(snapshot.course.stats).map(([key, val]) => (
                      <div key={key} className="p-3 rounded-lg bg-muted/30 border border-border">
                        <div className="text-xs text-muted-foreground">{key}</div>
                        <div className="text-lg font-bold">{String(val)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Validation issues */}
                {snapshot.course?.validationIssues?.length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="font-medium text-sm">Validierungsprobleme ({snapshot.course.validationIssues.length})</span>
                    </div>
                    <ul className="text-sm space-y-1">
                      {snapshot.course.validationIssues.slice(0, 10).map((issue: string, i: number) => (
                        <li key={i} className="text-muted-foreground">• {issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {snapshot.course?.validationIssues?.length === 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/30 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Keine Validierungsprobleme gefunden</span>
                  </div>
                )}
                {/* Raw JSON */}
                <ScrollArea className="h-[400px]">
                  <pre className="text-xs font-mono bg-muted/20 p-4 rounded-lg overflow-x-auto">
                    {JSON.stringify(snapshot, null, 2)}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analysis">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">AI-Qualitätsanalyse</CardTitle>
                <CardDescription>
                  Sende den Snapshot an {AI_PROVIDERS.find(p => p.id === selectedProvider)?.label} zur Analyse
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Optionaler Custom Prompt (z.B. 'Fokussiere auf MiniCheck-Qualität')…"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={2}
                />
                <Button onClick={runAIAnalysis} disabled={isAnalyzing}>
                  {isAnalyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  {isAnalyzing ? "Analysiere…" : "AI-Analyse starten"}
                </Button>
                {aiAnalysis && (
                  <ScrollArea className="h-[500px]">
                    <div className="prose prose-sm dark:prose-invert max-w-none p-4 bg-muted/20 rounded-lg whitespace-pre-wrap">
                      {aiAnalysis}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
