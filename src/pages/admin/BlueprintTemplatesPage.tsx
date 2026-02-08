import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Plus, 
  FileText, 
  Brain, 
  Variable, 
  Shield, 
  Shuffle, 
  CheckCircle, 
  AlertTriangle,
  Play,
  Eye,
  Loader2
} from "lucide-react";

interface Blueprint {
  id: string;
  name: string;
  question_template: string;
  knowledge_type: string;
  cognitive_level: string;
  exam_relevance: string;
  status: string;
  version: string;
  curriculum_id: string;
  learning_field_id?: string;
  competency_id?: string;
  canonical_statement: string;
  max_variations: number;
}

interface BlueprintFormData {
  name: string;
  curriculum_id: string;
  canonical_statement: string;
  question_template: string;
  knowledge_type: string;
  cognitive_level: string;
  exam_relevance: string;
  max_variations: number;
}

const BlueprintTemplatesPage = () => {
  const queryClient = useQueryClient();
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [generatingCount, setGeneratingCount] = useState(5);

  // Blueprints laden
  const { data: blueprints, isLoading } = useQuery({
    queryKey: ["question-blueprints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("question_blueprints")
        .select(`
          *,
          curricula(title),
          learning_fields(title, code),
          competencies(title, code)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Curricula für Dropdown
  const { data: curricula } = useQuery({
    queryKey: ["curricula-frozen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curricula")
        .select("id, title")
        .eq("status", "frozen");
      if (error) throw error;
      return data;
    },
  });

  // Varianten-Count pro Blueprint
  const { data: variantCounts } = useQuery({
    queryKey: ["blueprint-variant-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blueprint_variants")
        .select("blueprint_id");
      if (error) throw error;
      
      const counts: Record<string, number> = {};
      data?.forEach((v) => {
        counts[v.blueprint_id] = (counts[v.blueprint_id] || 0) + 1;
      });
      return counts;
    },
  });

  // Blueprint erstellen
  const createMutation = useMutation({
    mutationFn: async (data: BlueprintFormData) => {
      const insertData = {
        name: data.name,
        curriculum_id: data.curriculum_id,
        canonical_statement: data.canonical_statement,
        question_template: data.question_template,
        knowledge_type: data.knowledge_type as "concept" | "procedure" | "calculation" | "regulation",
        cognitive_level: data.cognitive_level as "remember" | "understand" | "apply" | "analyze",
        exam_relevance: data.exam_relevance as "low" | "medium" | "high",
        max_variations: data.max_variations,
      };
      const { error } = await supabase.from("question_blueprints").insert([insertData]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-blueprints"] });
      toast.success("Blueprint erstellt");
      setIsCreateDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Fehler beim Erstellen", { description: error.message });
    },
  });

  // Varianten generieren
  const generateMutation = useMutation({
    mutationFn: async ({ blueprintId, count }: { blueprintId: string; count: number }) => {
      const { data, error } = await supabase.functions.invoke("generate-blueprint-questions", {
        body: { blueprintId, count },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["blueprint-variant-counts"] });
      toast.success(`${data.generated} Varianten generiert`);
    },
    onError: (error) => {
      toast.error("Generierung fehlgeschlagen", { description: error.message });
    },
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      draft: "secondary",
      review: "outline",
      approved: "default",
      deprecated: "destructive",
    };
    return <Badge variant={variants[status] || "secondary"}>{status}</Badge>;
  };

  const getKnowledgeIcon = (type: string) => {
    switch (type) {
      case "concept": return <Brain className="h-4 w-4" />;
      case "procedure": return <FileText className="h-4 w-4" />;
      case "calculation": return <Variable className="h-4 w-4" />;
      case "regulation": return <Shield className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const getCognitiveBadgeColor = (level: string) => {
    switch (level) {
      case "remember": return "bg-primary/10 text-primary";
      case "understand": return "bg-secondary text-secondary-foreground";
      case "apply": return "bg-accent text-accent-foreground";
      case "analyze": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Blueprint-Templates</h1>
          <p className="text-muted-foreground">
            Prüfungssichere Fragenvorlagen mit kontrollierter Variation
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Neues Blueprint
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Blueprint erstellen</DialogTitle>
              <DialogDescription>
                Erstelle ein neues Blueprint-Template für strukturierte Fragenvarianten
              </DialogDescription>
            </DialogHeader>
            <CreateBlueprintForm
              curricula={curricula || []}
              onSubmit={(data) => createMutation.mutate(data)}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gesamt Blueprints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{blueprints?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Freigegeben
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {blueprints?.filter((b) => b.status === "approved").length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Generierte Varianten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-accent-foreground">
              {Object.values(variantCounts || {}).reduce((a, b) => a + b, 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              In Prüfung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">
              {blueprints?.filter((b) => b.status === "review").length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Blueprint List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {blueprints?.map((blueprint) => (
          <Card key={blueprint.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {getKnowledgeIcon(blueprint.knowledge_type)}
                  <CardTitle className="text-lg">{blueprint.name}</CardTitle>
                </div>
                {getStatusBadge(blueprint.status)}
              </div>
              <CardDescription className="line-clamp-2">
                {blueprint.canonical_statement}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Meta-Info */}
                <div className="flex flex-wrap gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs ${getCognitiveBadgeColor(blueprint.cognitive_level)}`}>
                    {blueprint.cognitive_level}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    v{blueprint.version}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {variantCounts?.[blueprint.id] || 0} / {blueprint.max_variations} Varianten
                  </Badge>
                </div>

                {/* Template Preview */}
                <div className="bg-muted/50 rounded-md p-3 text-sm font-mono">
                  {blueprint.question_template.slice(0, 100)}
                  {blueprint.question_template.length > 100 && "..."}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedBlueprint(blueprint)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Details
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => generateMutation.mutate({ 
                      blueprintId: blueprint.id, 
                      count: generatingCount 
                    })}
                    disabled={generateMutation.isPending || blueprint.status !== "approved"}
                  >
                    {generateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Shuffle className="h-4 w-4 mr-1" />
                    )}
                    Generieren
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {blueprints?.length === 0 && (
        <Card className="p-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Keine Blueprints vorhanden</h3>
          <p className="text-muted-foreground mb-4">
            Erstelle dein erstes Blueprint-Template für strukturierte Prüfungsfragen
          </p>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Erstes Blueprint erstellen
          </Button>
        </Card>
      )}

      {/* Detail Dialog */}
      {selectedBlueprint && (
        <BlueprintDetailDialog
          blueprint={selectedBlueprint}
          variantCount={variantCounts?.[selectedBlueprint.id] || 0}
          onClose={() => setSelectedBlueprint(null)}
          onGenerate={(count) => generateMutation.mutate({ 
            blueprintId: selectedBlueprint.id, 
            count 
          })}
          isGenerating={generateMutation.isPending}
        />
      )}
    </div>
  );
};

// Create Form Component
interface CreateBlueprintFormProps {
  curricula: { id: string; title: string }[];
  onSubmit: (data: BlueprintFormData) => void;
  isLoading: boolean;
}

const CreateBlueprintForm = ({ curricula, onSubmit, isLoading }: CreateBlueprintFormProps) => {
  const [formData, setFormData] = useState({
    name: "",
    curriculum_id: "",
    canonical_statement: "",
    question_template: "",
    knowledge_type: "concept",
    cognitive_level: "understand",
    exam_relevance: "medium",
    max_variations: 20,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="z.B. OSI-Schicht Zuordnung"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Curriculum</Label>
          <Select
            value={formData.curriculum_id}
            onValueChange={(value) => setFormData({ ...formData, curriculum_id: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Curriculum wählen" />
            </SelectTrigger>
            <SelectContent>
              {curricula.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Kanonische Aussage (SSOT)</Label>
        <Textarea
          value={formData.canonical_statement}
          onChange={(e) => setFormData({ ...formData, canonical_statement: e.target.value })}
          placeholder="Die fachliche Wahrheit, die geprüft wird..."
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Fragen-Template</Label>
        <Textarea
          value={formData.question_template}
          onChange={(e) => setFormData({ ...formData, question_template: e.target.value })}
          placeholder="Zu welcher OSI-Schicht gehört {protocol}?"
          className="font-mono"
          required
        />
        <p className="text-xs text-muted-foreground">
          Verwende {"{variable}"} für Platzhalter
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Wissenstyp</Label>
          <Select
            value={formData.knowledge_type}
            onValueChange={(value) => setFormData({ ...formData, knowledge_type: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concept">Konzept</SelectItem>
              <SelectItem value="procedure">Prozess</SelectItem>
              <SelectItem value="calculation">Berechnung</SelectItem>
              <SelectItem value="regulation">Vorschrift</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Kognitive Stufe</Label>
          <Select
            value={formData.cognitive_level}
            onValueChange={(value) => setFormData({ ...formData, cognitive_level: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="remember">Erinnern (K1)</SelectItem>
              <SelectItem value="understand">Verstehen (K2)</SelectItem>
              <SelectItem value="apply">Anwenden (K3)</SelectItem>
              <SelectItem value="analyze">Analysieren (K4)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Max. Varianten</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={formData.max_variations}
            onChange={(e) => setFormData({ ...formData, max_variations: parseInt(e.target.value) })}
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
        Blueprint erstellen
      </Button>
    </form>
  );
};

// Detail Dialog Component
interface BlueprintDetailDialogProps {
  blueprint: Blueprint;
  variantCount: number;
  onClose: () => void;
  onGenerate: (count: number) => void;
  isGenerating: boolean;
}

const BlueprintDetailDialog = ({ 
  blueprint, 
  variantCount, 
  onClose, 
  onGenerate, 
  isGenerating 
}: BlueprintDetailDialogProps) => {
  const [generateCount, setGenerateCount] = useState(5);

  // Variablen laden
  const { data: variables } = useQuery({
    queryKey: ["blueprint-variables", blueprint.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blueprint_variables")
        .select("*")
        .eq("blueprint_id", blueprint.id);
      if (error) throw error;
      return data;
    },
  });

  // Distraktoren laden
  const { data: distractors } = useQuery({
    queryKey: ["blueprint-distractors", blueprint.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blueprint_distractors")
        .select("*")
        .eq("blueprint_id", blueprint.id);
      if (error) throw error;
      return data;
    },
  });

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {blueprint.name}
          </DialogTitle>
          <DialogDescription>
            Version {blueprint.version} • {variantCount} / {blueprint.max_variations} Varianten
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="core" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="core">Core</TabsTrigger>
            <TabsTrigger value="variables">Variablen</TabsTrigger>
            <TabsTrigger value="distractors">Distraktoren</TabsTrigger>
            <TabsTrigger value="generate">Generieren</TabsTrigger>
          </TabsList>

          <TabsContent value="core" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Kanonische Aussage</Label>
              <p className="p-3 bg-muted rounded-md">{blueprint.canonical_statement}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Fragen-Template</Label>
              <pre className="p-3 bg-muted rounded-md font-mono text-sm whitespace-pre-wrap">
                {blueprint.question_template}
              </pre>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-muted rounded-md">
                <Label className="text-xs text-muted-foreground">Wissenstyp</Label>
                <p className="font-medium capitalize">{blueprint.knowledge_type}</p>
              </div>
              <div className="p-3 bg-muted rounded-md">
                <Label className="text-xs text-muted-foreground">Kognitive Stufe</Label>
                <p className="font-medium capitalize">{blueprint.cognitive_level}</p>
              </div>
              <div className="p-3 bg-muted rounded-md">
                <Label className="text-xs text-muted-foreground">Prüfungsrelevanz</Label>
                <p className="font-medium capitalize">{blueprint.exam_relevance}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="variables" className="mt-4">
            {variables?.length ? (
              <div className="space-y-3">
                {variables.map((v) => (
                  <Card key={v.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <code className="font-mono text-primary">{`{${v.variable_name}}`}</code>
                        <Badge variant="outline">{v.variable_type}</Badge>
                      </div>
                      {v.allowed_values && (
                        <div className="flex flex-wrap gap-1">
                          {v.allowed_values.map((val: string) => (
                            <Badge key={val} variant="secondary" className="text-xs">
                              {val}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {v.range_min !== null && (
                        <p className="text-sm text-muted-foreground">
                          Bereich: {v.range_min} - {v.range_max} (Schritt: {v.range_step})
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Keine Variablen definiert
              </p>
            )}
          </TabsContent>

          <TabsContent value="distractors" className="mt-4">
            {distractors?.length ? (
              <div className="space-y-3">
                {distractors.map((d, i) => (
                  <Card key={d.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-medium">Distraktor {i + 1}</span>
                        <Badge variant="outline" className="text-xs">
                          {d.error_type}
                        </Badge>
                      </div>
                      <pre className="font-mono text-sm bg-muted p-2 rounded">
                        {d.distractor_template}
                      </pre>
                      {d.error_explanation && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {d.error_explanation}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Keine Distraktoren definiert
              </p>
            )}
          </TabsContent>

          <TabsContent value="generate" className="mt-4">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="text-center">
                  <Shuffle className="h-12 w-12 mx-auto text-primary mb-4" />
                  <h3 className="text-lg font-medium">Varianten generieren</h3>
                  <p className="text-muted-foreground">
                    {blueprint.max_variations - variantCount} von {blueprint.max_variations} Varianten verfügbar
                  </p>
                </div>

                <div className="flex items-center gap-4 justify-center">
                  <Label>Anzahl:</Label>
                  <Input
                    type="number"
                    min={1}
                    max={blueprint.max_variations - variantCount}
                    value={generateCount}
                    onChange={(e) => setGenerateCount(parseInt(e.target.value))}
                    className="w-24"
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={() => onGenerate(generateCount)}
                  disabled={isGenerating || blueprint.status !== "approved"}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {generateCount} Varianten generieren
                </Button>

                {blueprint.status !== "approved" && (
                  <p className="text-center text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 inline mr-1" />
                    Blueprint muss freigegeben sein
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default BlueprintTemplatesPage;
