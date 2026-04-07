import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/seo/SEOHead";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Calculator, ArrowRight, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";

const SITE_URL = "https://examfitde.lovable.app";

type CalculatorResult = {
  pass_probability: number;
  trend: string;
  weak_areas: any[];
  recommendation: string;
  sessions_completed: number;
  avg_score: number;
  data_quality: string;
};

type CurriculumOption = {
  id: string;
  title: string;
};

export default function BestehensRechnerPage() {
  const { user } = useAuth();
  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);
  const [selectedCurriculum, setSelectedCurriculum] = useState("");
  const [studyHours, setStudyHours] = useState("5");
  const [weeksUntilExam, setWeeksUntilExam] = useState("8");
  const [confidence, setConfidence] = useState("5");
  const [hasPracticed, setHasPracticed] = useState(false);
  const [hasCourse, setHasCourse] = useState(false);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'result'>('input');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("curricula")
        .select("id, title")
        .order("title");
      setCurricula((data || []) as CurriculumOption[]);
    })();
  }, []);

  const calculate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("calculate-pass-probability", {
        body: {
          user_id: user?.id || null,
          curriculum_id: selectedCurriculum || null,
          email: email || null,
          self_assessment: {
            study_hours_per_week: Number(studyHours),
            weeks_until_exam: Number(weeksUntilExam),
            confidence: Number(confidence),
            has_practiced: hasPracticed,
            has_course: hasCourse,
          },
        },
      });
      if (error) throw error;
      setResult(data as CalculatorResult);
      setStep('result');
    } catch (err) {
      console.error("[BestehensRechner] error", err);
    } finally {
      setLoading(false);
    }
  };

  const probabilityColor = (p: number) =>
    p >= 80 ? 'text-emerald-600' : p >= 60 ? 'text-amber-600' : 'text-rose-600';

  const probabilityBg = (p: number) =>
    p >= 80 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <>
      <SEOHead
        title="Bestehe ich die IHK-Prüfung? – Kostenloser Bestehens-Rechner | ExamFit"
        description="Berechne deine Bestehens-Wahrscheinlichkeit für die IHK-Prüfung. Basierend auf deinem Lernstand, Übungszeit und Prüfungsvorbereitung."
        canonical={`${SITE_URL}/bestehens-rechner`}
        structuredData={[{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          "name": "ExamFit Bestehens-Rechner",
          "description": "Berechne deine Bestehens-Wahrscheinlichkeit für IHK-Prüfungen",
          "url": `${SITE_URL}/bestehens-rechner`,
          "applicationCategory": "EducationalApplication",
          "operatingSystem": "Any",
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "EUR" },
        }]}
      />

      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-2xl mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-8">
            <Badge variant="outline" className="mb-3">
              <Calculator className="h-3 w-3 mr-1" />
              Kostenlos & sofort
            </Badge>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground mb-2">
              Bestehe ich die IHK-Prüfung?
            </h1>
            <p className="text-muted-foreground">
              Berechne in 30 Sekunden deine Bestehens-Wahrscheinlichkeit
            </p>
          </div>

          {step === 'input' ? (
            <Card>
              <CardContent className="p-6 space-y-5">
                {/* Beruf */}
                <div>
                  <Label className="text-sm font-medium">Dein Ausbildungsberuf / Prüfung</Label>
                  <Select value={selectedCurriculum} onValueChange={setSelectedCurriculum}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Beruf auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {curricula.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Lernstunden */}
                <div>
                  <Label className="text-sm font-medium">Lernstunden pro Woche</Label>
                  <Input
                    type="number"
                    min="0"
                    max="40"
                    value={studyHours}
                    onChange={e => setStudyHours(e.target.value)}
                    className="mt-1.5"
                  />
                </div>

                {/* Wochen bis Prüfung */}
                <div>
                  <Label className="text-sm font-medium">Wochen bis zur Prüfung</Label>
                  <Input
                    type="number"
                    min="1"
                    max="52"
                    value={weeksUntilExam}
                    onChange={e => setWeeksUntilExam(e.target.value)}
                    className="mt-1.5"
                  />
                </div>

                {/* Selbsteinschätzung */}
                <div>
                  <Label className="text-sm font-medium">Wie sicher fühlst du dich? (1-10)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={confidence}
                    onChange={e => setConfidence(e.target.value)}
                    className="mt-1.5"
                  />
                </div>

                {/* Checkboxes */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasPracticed}
                      onChange={e => setHasPracticed(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Ich habe bereits Übungsprüfungen gemacht</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasCourse}
                      onChange={e => setHasCourse(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Ich nutze einen Vorbereitungskurs</span>
                  </label>
                </div>

                {/* Email (optional) */}
                <div>
                  <Label className="text-sm font-medium">E-Mail (optional – für detaillierten Report)</Label>
                  <Input
                    type="email"
                    placeholder="deine@email.de"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="mt-1.5"
                  />
                </div>

                <Button
                  onClick={calculate}
                  disabled={loading}
                  className="w-full gradient-primary text-primary-foreground rounded-xl h-12 text-base"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      Bestehens-Wahrscheinlichkeit berechnen
                      <ArrowRight className="h-5 w-5 ml-2" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : result ? (
            <div className="space-y-6">
              {/* Big Score */}
              <Card className="overflow-hidden">
                <CardContent className="p-8 text-center">
                  <p className="text-sm text-muted-foreground mb-2">Deine Bestehens-Wahrscheinlichkeit</p>
                  <p className={`text-6xl font-display font-bold ${probabilityColor(result.pass_probability)}`}>
                    {result.pass_probability}%
                  </p>
                  <Progress
                    value={result.pass_probability}
                    className="mt-4 h-3"
                  />
                  <div className="flex items-center justify-center gap-2 mt-4">
                    {result.pass_probability >= 60 ? (
                      <CheckCircle className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                    )}
                    <span className="text-sm font-medium">
                      {result.pass_probability >= 80 ? 'Sehr gute Chancen!' :
                       result.pass_probability >= 60 ? 'Gute Chancen – weiter so!' :
                       result.pass_probability >= 40 ? 'Noch Luft nach oben' :
                       'Intensive Vorbereitung empfohlen'}
                    </span>
                  </div>
                  {result.data_quality !== 'self_assessment' && (
                    <Badge variant="outline" className="mt-3 text-[10px]">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      Basierend auf {result.sessions_completed} Übungsprüfungen (Ø {result.avg_score}%)
                    </Badge>
                  )}
                </CardContent>
              </Card>

              {/* Recommendation */}
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-2">📋 Empfehlung</h3>
                  <p className="text-sm text-muted-foreground">{result.recommendation}</p>
                </CardContent>
              </Card>

              {/* CTA */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6 text-center">
                  <h3 className="font-display font-bold text-lg mb-2">
                    Deine Chancen verbessern?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    ExamFit trainiert gezielt deine Schwächen und steigert deine Bestehens-Wahrscheinlichkeit.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 justify-center">
                    <Link to="/pruefungsreife-check">
                      <Button className="gradient-primary text-primary-foreground rounded-xl group w-full sm:w-auto">
                        Prüfungsreife testen
                        <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => { setStep('input'); setResult(null); }}
                    >
                      Nochmal berechnen
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <p className="text-center text-xs text-muted-foreground mt-8">
            © ExamFit – Intelligentes Prüfungstraining · Die Berechnung basiert auf statistischen Modellen und ersetzt keine individuelle Beratung.
          </p>
        </div>
      </div>
    </>
  );
}
