import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, XCircle, AlertTriangle, Shield, BookOpen, ClipboardCheck, MessageSquare, FileText, Bot, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

export default function IntegrityReportCard({ report, curriculumId, packageId }: { report: any; curriculumId?: string; packageId?: string }) {
  const [liveCounts, setLiveCounts] = useState<{
    questions: number; questionsApproved: number; questionsDraft: number;
    oralBlueprints: number; handbookChapters: number; tutorIndex: number;
    lessonsTotal: number; lessonsReal: number; lessonsPlaceholders: number; lessonsAvgLen: number;
  } | null>(null);

  useEffect(() => {
    if (!curriculumId && !packageId) return;
    const fetchLive = async () => {
      const sb = supabase as any;
      const [qTotalRes, qApprovedRes, qDraftRes, oralBlueprintRes, oralTemplateRes, hbRes, tutorRes, realnessRes] = await Promise.all([
        // Total exam questions — head:true avoids fetching rows (no 1000-row limit)
        curriculumId
          ? sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('curriculum_id', curriculumId)
          : Promise.resolve({ count: 0 }),
        // Approved count — server-side filter + head:true
        curriculumId
          ? sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('curriculum_id', curriculumId).eq('status', 'approved')
          : Promise.resolve({ count: 0 }),
        // Draft count — server-side filter + head:true
        curriculumId
          ? sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('curriculum_id', curriculumId).eq('status', 'draft')
          : Promise.resolve({ count: 0 }),
        // Oral blueprints
        curriculumId
          ? sb.from('oral_exam_blueprints').select('id', { count: 'exact', head: true }).eq('curriculum_id', curriculumId)
          : Promise.resolve({ count: 0 }),
        // Oral session templates (the actual prepared scenarios, not learner sessions)
        packageId
          ? sb.from('oral_exam_session_templates').select('id', { count: 'exact', head: true }).eq('package_id', packageId)
          : Promise.resolve({ count: 0 }),
        curriculumId
          ? sb.from('handbook_chapters').select('id', { count: 'exact', head: true }).eq('curriculum_id', curriculumId)
          : Promise.resolve({ count: 0 }),
        packageId
          ? sb.from('ai_tutor_context_index').select('id', { count: 'exact', head: true }).eq('package_id', packageId)
          : Promise.resolve({ count: 0 }),
        packageId
          ? supabase.functions.invoke('admin-ops', {
              body: { action: 'get_package_realness', package_id: packageId },
            }).then(r => r.data)
          : Promise.resolve(null),
      ]);
      const realnessJson = realnessRes as any;
      const realness = realnessJson?.ok ? realnessJson.realness : null;
      setLiveCounts({
        questions: qTotalRes.count ?? 0,
        questionsApproved: qApprovedRes.count ?? 0,
        questionsDraft: qDraftRes.count ?? 0,
        oralBlueprints: Math.max(oralBlueprintRes.count ?? 0, oralTemplateRes.count ?? 0),
        handbookChapters: hbRes.count ?? 0,
        tutorIndex: tutorRes.count ?? 0,
        lessonsTotal: realness?.lessons_total ?? 0,
        lessonsReal: realness?.real_content ?? 0,
        lessonsPlaceholders: realness?.placeholders ?? 0,
        lessonsAvgLen: realness?.avg_len ?? 0,
      });
    };
    fetchLive();
    const iv = setInterval(fetchLive, 15000);
    return () => clearInterval(iv);
  }, [curriculumId, packageId]);

  if (!report || typeof report !== 'object') return null;

  // ── Track-aware scoring ──────────────────────────────────
  const scoreScope = report.score_scope as string | undefined;
  const examScore = report.exam_score ?? report.score ?? 0;
  const learningScore = report.learning_score ?? null;
  const totalScore = report.score ?? 0;
  const skippedLearning = report.skipped_learning_gates === true || scoreScope === 'exam_only';
  const passed = report.passed ?? (totalScore >= 80);

  const v3 = report.v3?.stats;
  const examTotal = liveCounts?.questions ?? report.exam?.total ?? v3?.questionCount ?? null;
  const examApproved = liveCounts?.questionsApproved ?? 0;
  
  const lessonsActual = liveCounts ? liveCounts.lessonsReal : (report.lessons?.actual ?? v3?.lessonCount ?? null);
  const lessonsExpected = liveCounts ? liveCounts.lessonsTotal : (report.lessons?.expected ?? v3?.lessonTarget ?? null);
  const lessonsDetail = liveCounts
    ? (liveCounts.lessonsPlaceholders > 0
      ? `${liveCounts.lessonsPlaceholders} Platzhalter, ∅ ${liveCounts.lessonsAvgLen} Zeichen`
      : `${liveCounts.lessonsReal}/${liveCounts.lessonsTotal} real, ∅ ${liveCounts.lessonsAvgLen} Zeichen`)
    : (report.lessons?.duplicates > 0 ? `${report.lessons.duplicates} Duplikate` : null);

  const sections = [
    { label: 'Lektionen (real)', actual: lessonsActual, expected: lessonsExpected, icon: BookOpen, detail: lessonsDetail },
    { label: 'Prüfungsfragen', actual: examTotal, expected: report.exam?.target ?? v3?.questionTarget ?? 1000, icon: ClipboardCheck, detail: examApproved > 0 ? `${examApproved} approved` : liveCounts ? `${liveCounts.questionsDraft} draft, 0 approved` : null },
    { label: 'Mündliche Szenarien', actual: liveCounts?.oralBlueprints ?? report.oral?.total ?? v3?.oralCount ?? null, expected: report.oral?.target ?? v3?.oralTarget ?? null, icon: MessageSquare },
    { label: 'Handbuch-Kapitel', actual: liveCounts?.handbookChapters ?? report.handbook?.chapters ?? v3?.handbookChapters ?? null, expected: report.handbook?.target ?? v3?.handbookTarget ?? null, icon: FileText, detail: report.handbook?.sections ? `${report.handbook.sections} Abschnitte` : null },
    { label: 'AI Tutor Index', actual: liveCounts?.tutorIndex ?? ((report.tutor_index === true || report.tutor_index === 1 || v3?.tutorIndex === true || v3?.tutorIndex === 1 || (typeof report.tutor_index === 'object' && report.tutor_index !== null)) ? 1 : 0), expected: 1, icon: Bot },
  ];

  const snapshotAge = report.checked_at ? Math.round((Date.now() - new Date(report.checked_at).getTime()) / 3600000) : null;

  return (
    <Card className={cn("border", passed && !skippedLearning ? "border-success/30" : skippedLearning ? "border-warning/30" : "border-destructive/30")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Qualitätsbericht
            {liveCounts && <Badge variant="outline" className="text-[9px] text-primary">LIVE</Badge>}
            {skippedLearning && (
              <Badge variant="outline" className="text-[9px] text-warning border-warning/40 bg-warning/10">
                Exam-only
              </Badge>
            )}
          </span>
          <span className={cn("text-lg font-bold", totalScore >= 80 && !skippedLearning ? "text-success" : totalScore >= 60 ? "text-warning" : "text-destructive")}>
            {totalScore}/100
          </span>
        </CardTitle>

        {/* Sub-scores when available */}
        {(learningScore != null || skippedLearning) && (
          <div className="flex gap-3 text-[10px] mt-1">
            <span className="text-muted-foreground">
              Exam: <span className="font-mono text-foreground">{examScore}</span>
            </span>
            <span className="text-muted-foreground">
              Learning: {skippedLearning && learningScore == null
                ? <span className="font-mono text-warning">übersprungen</span>
                : <span className="font-mono text-foreground">{learningScore ?? '–'}</span>
              }
            </span>
          </div>
        )}

        {skippedLearning && (
          <div className="flex items-start gap-1.5 mt-1.5 p-1.5 rounded bg-warning/10 border border-warning/20">
            <Info className="h-3 w-3 text-warning shrink-0 mt-0.5" />
            <p className="text-[10px] text-warning leading-tight">
              Learning-Gates übersprungen (Track: Exam-First). Score bildet nur Prüfungspool ab. Für Veröffentlichung als Vollkurs wird AUSBILDUNG_VOLL benötigt.
            </p>
          </div>
        )}

        {snapshotAge != null && snapshotAge > 1 && (
          <p className="text-[10px] text-warning">⚠ Snapshot {snapshotAge}h alt – Fragen-Counts sind live</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {sections.map(s => {
          const pct = s.expected > 0 ? Math.min(100, Math.round((s.actual / s.expected) * 100)) : 0;
          const ok = s.actual >= s.expected;
          const Icon = s.icon;
          if (s.actual == null && s.expected == null) return null;
          return (
            <div key={s.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5"><Icon className="h-3 w-3 text-muted-foreground" /> {s.label}</span>
                <span className={cn("font-mono", ok ? "text-success" : "text-warning")}>
                  {s.actual ?? 0}{s.expected != null ? `/${s.expected}` : ''}
                  {s.detail && <span className="text-muted-foreground ml-1">({s.detail})</span>}
                </span>
              </div>
              {s.expected != null && <Progress value={pct} className="h-1" />}
            </div>
          );
        })}
        {report.exam?.difficulty && Object.keys(report.exam.difficulty).length > 0 && (
          <div className="mt-3 pt-2 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Schwierigkeitsverteilung</p>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(report.exam.difficulty).map(([level, count]) => (
                <Badge key={level} variant="outline" className="text-[10px]">{level}: {String(count)}</Badge>
              ))}
            </div>
          </div>
        )}
        {report.exam?.lf_coverage && report.exam.lf_coverage.total > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Lernfeld-Abdeckung:</span>
            <span className={cn("font-mono", report.exam.lf_coverage.covered >= report.exam.lf_coverage.total ? "text-success" : "text-warning")}>
              {report.exam.lf_coverage.covered}/{report.exam.lf_coverage.total}
            </span>
          </div>
        )}
        {((report.issues?.length || 0) + (report.warnings?.length || 0)) > 0 && (
          <div className="mt-3 pt-2 border-t border-border/30 space-y-1">
            {(report.issues || []).map((issue: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-destructive">
                <XCircle className="h-3 w-3 shrink-0" />
                <span>{issue.type?.replace(/_/g, ' ')}: {JSON.stringify(issue).slice(0, 80)}</span>
              </div>
            ))}
            {(report.warnings || []).map((w: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{w.type?.replace(/_/g, ' ')}: {JSON.stringify(w).slice(0, 80)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}