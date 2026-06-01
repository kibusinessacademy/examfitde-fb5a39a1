import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Mic, 
  MicOff,
  Clock, 
  Send, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Play,
  RotateCcw,
  Trophy,
  Target,
  BookOpen,
  Lightbulb,
  TrendingUp,
  Loader2,
  Volume2,
  VolumeX,
  Square,
  FileText,
  MessageSquare
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOralExam, type EvaluationResult } from '@/hooks/useOralExam';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { Paywall } from '@/components/shop/Paywall';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import PageExplainer from '@/components/admin/PageExplainer';
import { useTerminology } from '@/hooks/useProgramType';
import { OralWaveform } from '@/components/oral/OralWaveform';
import { ExaminerThinkingBeat } from '@/components/oral/ExaminerThinkingBeat';
import { OralReplayCard, type TurnMetric } from '@/components/oral/OralReplayCard';

type ExamPhase = 'setup' | 'question' | 'listening' | 'evaluation' | 'results';

// Web Speech API Types
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onsoundstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export default function OralExamTrainer() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<ExamPhase>('setup');
  const [selectedCurriculum, setSelectedCurriculum] = useState<string | null>(() => searchParams.get('curriculum'));
  const { t, isAcademic } = useTerminology(selectedCurriculum);
  const [answer, setAnswer] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(180);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  // Cinematic Replay — client-side turn metrics (no DB writes).
  const [turnMetrics, setTurnMetrics] = useState<TurnMetric[]>([]);
  const turnStartRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [showSampleAnswer, setShowSampleAnswer] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastTranscriptAtRef = useRef<number>(0);
  const noSpeechWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Oral Voice Activation v1 (browser-native) — Web Speech API only.
  // Persona-Wirkung läuft über Frage-/Followup-Logik (oral-exam Engine),
  // NICHT über externe Voice-Provider. Kein ElevenLabs, kein neuer Provider.

  // Keep ref in sync with state to avoid stale closures in callbacks
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Permissions API: passiv abfragen, falls verfügbar (Chromium).
  useEffect(() => {
    const nav = navigator as Navigator & { permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> } };
    if (!nav.permissions?.query) return;
    let status: PermissionStatus | null = null;
    nav.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s;
        setMicPermission(s.state as typeof micPermission);
        s.onchange = () => setMicPermission(s.state as typeof micPermission);
      })
      .catch(() => { /* Safari/FF: ignore */ });
    return () => { if (status) status.onchange = null; };
  }, []);

  const stopNoSpeechWatchdog = useCallback(() => {
    if (noSpeechWatchdogRef.current) {
      clearInterval(noSpeechWatchdogRef.current);
      noSpeechWatchdogRef.current = null;
    }
  }, []);

  const stopRecordingHard = useCallback((reason?: { title: string; description: string; variant?: 'default' | 'destructive' }) => {
    stopNoSpeechWatchdog();
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    isRecordingRef.current = false;
    setIsRecording(false);
    if (reason) toast({ title: reason.title, description: reason.description, variant: reason.variant ?? 'destructive' });
  }, [stopNoSpeechWatchdog, toast]);

  // Initialize Speech Recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'de-DE';

    rec.onstart = () => {
      lastTranscriptAtRef.current = Date.now();
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      lastTranscriptAtRef.current = Date.now();
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        }
      }
      if (finalTranscript) setAnswer((prev) => prev + finalTranscript);
    };

    rec.onerror = (event) => {
      const code = event?.error ?? 'unknown';
      // Spezifische, nicht-blockierende Behandlung pro Fehlercode.
      switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
          setMicPermission('denied');
          stopRecordingHard({
            title: 'Mikrofon-Zugriff blockiert',
            description: 'Bitte erlaube den Mikrofon-Zugriff in den Browser-Einstellungen und lade die Seite neu. Texteingabe bleibt verfügbar.',
          });
          return;
        case 'audio-capture':
          stopRecordingHard({
            title: 'Kein Mikrofon gefunden',
            description: 'Schließe ein Mikrofon an oder wähle ein anderes Audiogerät. Texteingabe bleibt verfügbar.',
          });
          return;
        case 'no-speech':
          // Watchdog hat ggf. schon gehandelt — sanfter Hinweis, kein Hard-Stop.
          toast({
            title: 'Nichts gehört',
            description: 'Sprich bitte deutlich oder beende die Aufnahme manuell.',
          });
          return;
        case 'network':
          stopRecordingHard({
            title: 'Spracherkennung offline',
            description: 'Verbindung zur Spracherkennung verloren. Bitte erneut versuchen oder Texteingabe nutzen.',
          });
          return;
        case 'aborted':
          // Vom Code selbst gestoppt — keine Toast-Spam.
          return;
        default:
          stopRecordingHard({
            title: 'Spracherkennung fehlgeschlagen',
            description: `Fehler: ${code}. Bitte Texteingabe nutzen.`,
          });
      }
    };

    rec.onend = () => {
      if (isRecordingRef.current) {
        try { rec.start(); } catch { stopRecordingHard(); }
      } else {
        stopNoSpeechWatchdog();
      }
    };

    recognitionRef.current = rec;
    setSpeechSupported(true);

    return () => {
      stopNoSpeechWatchdog();
      try { rec.abort(); } catch { /* noop */ }
      window.speechSynthesis?.cancel();
    };
  }, [stopRecordingHard, stopNoSpeechWatchdog, toast]);

  const { data: curricula } = useQuery({
    queryKey: ['curricula-for-oral-exam'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title')
        .eq('status', 'frozen')
        .order('title');
      if (error) throw error;
      return data;
    }
  });

  // Oral Activation v2 — Persona-Surface aus oral_exam_session_templates.
  // Wenn kein Template existiert: Defaults (single examiner, stress=1, "sachlich").
  // Wirkung läuft serverseitig über oral-exam Engine + Followup-Chains.
  const { data: oralPersona } = useQuery({
    queryKey: ['oral-persona', selectedCurriculum],
    enabled: !!selectedCurriculum,
    queryFn: async () => {
      const sb = supabase as any;
      const { data } = await sb
        .from('oral_exam_session_templates')
        .select('examiner_mode, stress_level, followup_chains, metadata')
        .eq('curriculum_id', selectedCurriculum)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      const examinerMode = (data?.examiner_mode as string) || 'single';
      const stressLevel = (data?.stress_level as number) ?? 1;
      const styleLabel =
        stressLevel >= 3 ? 'Stress' : stressLevel === 2 ? 'kritisch' : 'sachlich';
      return { examinerMode, stressLevel, styleLabel, hasTemplate: !!data };
    },
  });

  // Product-based access check (bridges to legacy flags during transition)
  const { data: hasAccess, isLoading: entitlementLoading } = useProductAccessByCurriculum(
    selectedCurriculum || undefined,
    'oral_trainer'
  );
  const curriculumTitle = curricula?.find(c => c.id === selectedCurriculum)?.title;

  const {
    session,
    currentQuestion,
    evaluation,
    isLoading,
    startSession,
    submitAnswer,
    nextQuestion,
    finishSession,
    reset,
    progress
  } = useOralExam({
    curriculumId: selectedCurriculum || '',
    mode: 'practice',
    totalQuestions: 5
  });

  // Browser-native TTS via Web Speech API. Persona-Effekt entsteht über die
  // Fragelogik (oral-exam Engine + Followup-Chains), nicht über Stimm-Variation.
  const speakText = useCallback((text: string, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) {
      // Stiller Fallback in Textmodus — UI bleibt funktional.
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => { setIsSpeaking(false); onEnd?.(); };
    utterance.onerror = () => { setIsSpeaking(false); onEnd?.(); };
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  // Quality-Gate für Sprach-Antworten (Stille / leer / zu kurz / unverständlich).
  // Reine Heuristik, kein externer Provider.
  const evaluateTranscriptQuality = useCallback((raw: string): { ok: true } | { ok: false; reason: string } => {
    const t = (raw ?? '').trim();
    if (t.length === 0) return { ok: false, reason: 'Keine Sprache erkannt. Bitte sprich deutlich ins Mikrofon.' };
    const wordCount = t.split(/\s+/).filter(Boolean).length;
    if (t.length < 8 || wordCount < 2) return { ok: false, reason: 'Antwort zu kurz. Bitte vollständiger antworten.' };
    const vowelRatio = (t.match(/[aeiouäöüAEIOUÄÖÜ]/g)?.length ?? 0) / Math.max(t.replace(/\s/g, '').length, 1);
    if (vowelRatio < 0.15) return { ok: false, reason: 'Antwort unverständlich. Bitte wiederhole sie deutlicher.' };
    return { ok: true };
  }, []);

  // Explizite Mikrofon-Freigabe vor Start der Recognition.
  // Liefert klare Fehlermeldungen statt am Recognition-Start zu hängen.
  const ensureMicPermission = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({
        title: 'Mikrofon nicht verfügbar',
        description: 'Dein Browser unterstützt keinen Mikrofon-Zugriff. Bitte Texteingabe nutzen.',
        variant: 'destructive',
      });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stream sofort wieder freigeben — Recognition öffnet ihren eigenen.
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission('granted');
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name ?? 'Error';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setMicPermission('denied');
        toast({
          title: 'Mikrofon-Zugriff abgelehnt',
          description: 'Bitte erlaube den Mikrofon-Zugriff im Browser (Adressleiste → Schloss-Symbol) und versuche es erneut.',
          variant: 'destructive',
        });
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        toast({
          title: 'Kein Mikrofon gefunden',
          description: 'Schließe ein Mikrofon an oder wähle ein anderes Audiogerät.',
          variant: 'destructive',
        });
      } else if (name === 'NotReadableError') {
        toast({
          title: 'Mikrofon belegt',
          description: 'Ein anderes Programm nutzt gerade dein Mikrofon. Bitte schließen und erneut versuchen.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Mikrofon-Fehler',
          description: `Zugriff fehlgeschlagen (${name}). Bitte Texteingabe nutzen.`,
          variant: 'destructive',
        });
      }
      return false;
    }
  }, [toast]);

  const toggleRecording = useCallback(async () => {
    if (!recognitionRef.current) {
      toast({
        title: 'Spracheingabe nicht verfügbar',
        description: 'Dein Browser unterstützt keine Spracherkennung. Nutze die Texteingabe.',
        variant: 'destructive',
      });
      return;
    }
    if (isRecording) {
      stopRecordingHard();
      return;
    }
    const granted = await ensureMicPermission();
    if (!granted) return;

    try {
      recognitionRef.current.start();
      setIsRecording(true);
      lastTranscriptAtRef.current = Date.now();
      toast({ title: 'Sprachaufnahme gestartet', description: 'Sprich jetzt deine Antwort...' });

      // No-Speech-Watchdog: wenn 12s kein Transkript-Update, sanfter Hinweis;
      // nach 25s harter Stop, damit der Nutzer nicht hängen bleibt.
      stopNoSpeechWatchdog();
      let warned = false;
      noSpeechWatchdogRef.current = setInterval(() => {
        const silentMs = Date.now() - lastTranscriptAtRef.current;
        if (!warned && silentMs > 12_000) {
          warned = true;
          toast({
            title: 'Noch nichts gehört',
            description: 'Sprich lauter oder prüfe das Mikrofon. Bei Stille wird die Aufnahme automatisch beendet.',
          });
        }
        if (silentMs > 25_000) {
          stopRecordingHard({
            title: 'Aufnahme automatisch beendet',
            description: 'Keine Sprache erkannt. Bitte erneut starten oder Texteingabe nutzen.',
            variant: 'default',
          });
        }
      }, 2_000);
    } catch (e) {
      const name = (e as DOMException)?.name ?? 'Error';
      // InvalidStateError = bereits gestartet → abort + ignore
      if (name === 'InvalidStateError') {
        try { recognitionRef.current.abort(); } catch { /* noop */ }
        setIsRecording(false);
        return;
      }
      toast({
        title: 'Mikrofon nicht verfügbar',
        description: `Spracherkennung konnte nicht starten (${name}). Bitte Texteingabe nutzen.`,
        variant: 'destructive',
      });
    }
  }, [isRecording, ensureMicPermission, stopRecordingHard, stopNoSpeechWatchdog, toast]);


  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isTimerActive && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (timeRemaining === 0 && (phase === 'question' || phase === 'listening')) {
      handleSubmitAnswer();
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timeRemaining, phase]);

  const handleStartExam = async () => {
    if (!selectedCurriculum) return;
    await startSession();
    setPhase('question');
    setTimeRemaining(180);
    setIsTimerActive(true);
    setAnswer('');
    setShowSampleAnswer(false);
    setTurnMetrics([]);
    sessionStartRef.current = Date.now();
  };

  // Oral Activation v2 — Auto-Start aus Kursbezug.
  // Wenn ?curriculum= gesetzt, Zugriff vorhanden und noch in setup-Phase:
  // Session sofort starten — kein generischer Trainer-Einstieg mehr.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (phase !== 'setup') return;
    if (!selectedCurriculum) return;
    if (entitlementLoading) return;
    if (hasAccess !== true) return;
    autoStartedRef.current = true;
    handleStartExam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, selectedCurriculum, entitlementLoading, hasAccess]);

  // Auto-Vorlesen bei neuer Frage (wie im Beispiel-Code)
  useEffect(() => {
    if (phase === 'question' && currentQuestion?.question_text && !isSpeaking) {
      // Automatisch vorlesen wenn Frage erscheint
      speakText(currentQuestion.question_text, () => {
        // Nach dem Vorlesen automatisch auf "listening" wechseln
        setPhase('listening');
        turnStartRef.current = Date.now();
      });
    }
  }, [currentQuestion?.id, phase]);

  const handleReadQuestion = () => {
    if (currentQuestion?.question_text) {
      speakText(currentQuestion.question_text, () => {
        setPhase('listening');
        turnStartRef.current = Date.now();
      });
    }
  };

  const handleSubmitAnswer = async () => {
    setIsTimerActive(false);
    stopRecordingHard();
    stopSpeaking();
    // Quality-Gate vor Submit: Stille / leer / zu kurz / unverständlich.
    const gate = evaluateTranscriptQuality(answer);
    if (!gate.ok) {
      toast({ title: 'Antwort nicht ausreichend', description: gate.reason, variant: 'destructive' });
      // Timer wieder starten — Kandidat bekommt zweite Chance, kein Submit.
      setIsTimerActive(true);
      return;
    }
    const responseMs = turnStartRef.current ? Date.now() - turnStartRef.current : 0;
    const answerWords = answer.trim().split(/\s+/).filter(Boolean).length;
    const result = await submitAnswer(answer);
    const hadFollowUp = Boolean((result as any)?.follow_up_question || (evaluation as any)?.follow_up_question);
    setTurnMetrics((prev) => [
      ...prev,
      { questionIndex: prev.length, answerWords, responseMs, hadFollowUp },
    ]);
    setPhase('evaluation');
  };

  const handleNextQuestion = async () => {
    setShowSampleAnswer(false);
    stopSpeaking(); // Stoppe ggf. laufende Sprachausgabe
    
    if (progress && progress.current >= progress.total) {
      await finishSession();
      setPhase('results');
    } else {
      await nextQuestion();
      setPhase('question'); // Wechselt zu 'question', useEffect triggert Auto-Vorlesen
      setTimeRemaining(180);
      setIsTimerActive(true);
      setAnswer('');
    }
  };

  const handleRestart = () => {
    reset();
    setPhase('setup');
    setAnswer('');
    setTimeRemaining(180);
    setIsTimerActive(false);
    stopRecordingHard();
    setShowSampleAnswer(false);
    stopSpeaking();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 0.5) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 0.8) return 'bg-emerald-500/10 border-emerald-500/30';
    if (score >= 0.5) return 'bg-amber-500/10 border-amber-500/30';
    return 'bg-rose-500/10 border-rose-500/30';
  };

  // Show paywall if curriculum selected but no access
  if (selectedCurriculum && !entitlementLoading && hasAccess === false) {
    return (
      <Paywall 
        feature="oral_trainer" 
        curriculumId={selectedCurriculum}
        curriculumTitle={curriculumTitle}
      />
    );
  }

  const stressActive = (oralPersona?.stressLevel ?? 1) >= 3 && (phase === 'question' || phase === 'listening' || phase === 'evaluation');

  return (
    <div
      className={cn(
        "container max-w-4xl py-8 relative transition-colors duration-slow ease-out-expo",
        stressActive && "oral-stress-vignette",
      )}
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Mic className="h-8 w-8 text-primary" />
          {t('oralTitle')}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('oralSubline')}
        </p>
        {/* Oral Activation v2 — Persona/Dual-Examiner-Sichtbarkeit */}
        {selectedCurriculum && oralPersona && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {curriculumTitle && (
              <Badge variant="secondary" className="gap-1">
                <BookOpen className="h-3 w-3" />
                {curriculumTitle}
              </Badge>
            )}
            <Badge
              variant={oralPersona.stressLevel >= 2 ? 'destructive' : 'outline'}
              className="gap-1"
              aria-label={`Prüferstil: ${oralPersona.styleLabel}`}
            >
              <AlertCircle className="h-3 w-3" />
              Prüferstil: {oralPersona.styleLabel}
            </Badge>
            {oralPersona.examinerMode === 'dual' ? (
              <Badge variant="default" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                Prüfer A &amp; B (Dual)
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                Einzelprüfer
              </Badge>
            )}
          </div>
        )}
      </div>

      <PageExplainer
        title={t('oralHowTitle')}
        description={t('oralHowDesc')}
        workflow={[
          { label: 'Curriculum wählen', active: phase === 'setup' },
          { label: 'Frage hören', active: phase === 'question' },
          { label: 'Antworten', active: phase === 'listening' },
          { label: 'Bewertung', active: phase === 'evaluation' },
          { label: 'Ergebnis', active: phase === 'results' },
        ]}
        actions={[
          'Curriculum wählen, dann "' + t('examStart') + '"',
          'Frage wird automatisch vorgelesen – danach kannst du per Mikrofon oder Text antworten',
          '3 Minuten Antwortzeit pro Frage',
          'Nach jeder Antwort: KI-Bewertung mit Musterantwort und Nachfragen',
        ]}
        tips={[
          'Nutze die Sprachaufnahme für eine realistische Simulation',
          'Die KI bewertet nach Fachkompetenz, Ausdrucksfähigkeit und Strukturiertheit',
          'Du kannst dir die Musterantwort nach der Bewertung anzeigen lassen',
        ]}
      />

      {phase !== 'setup' && phase !== 'results' && progress && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              Frage {progress.current + 1} von {progress.total}
            </span>
            {(phase === 'question' || phase === 'listening') && (
              <Badge 
                variant={timeRemaining < 30 ? 'destructive' : 'secondary'}
                className="flex items-center gap-1"
              >
                <Clock className="h-3 w-3" />
                {formatTime(timeRemaining)}
              </Badge>
            )}
          </div>
          <Progress value={progress.percent} className="h-2" />
        </div>
      )}

      {phase === 'setup' && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              {t('examPrepare')}
            </CardTitle>
            <CardDescription>
              Wähle ein Curriculum und starte deine Übungsprüfung
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">
                {isAcademic ? 'Studiengang / Curriculum' : 'Ausbildungsberuf / Curriculum'}
              </label>
              <div className="grid gap-2">
                {curricula?.map(curriculum => (
                  <Button
                    key={curriculum.id}
                    variant={selectedCurriculum === curriculum.id ? 'default' : 'outline'}
                    className="justify-start h-auto py-3"
                    onClick={() => setSelectedCurriculum(curriculum.id)}
                  >
                    <BookOpen className="h-4 w-4 mr-2" />
                    {curriculum.title}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-medium">So funktioniert's:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• {t('oralQStyle')}</li>
                <li>• 3 Minuten Antwortzeit pro Frage</li>
                <li>• {t('oralCriteria')}</li>
                <li>• Detailliertes Feedback nach jeder Antwort</li>
                {speechSupported && <li>• <strong>Neu:</strong> Sprachaufnahme für authentische Simulation</li>}
              </ul>
            </div>

            <Button 
              size="lg" 
              className="w-full"
              disabled={!selectedCurriculum || isLoading}
              onClick={handleStartExam}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {t('examStart')}
            </Button>
          </CardContent>
        </Card>
      )}

      {(phase === 'question' || phase === 'listening') && currentQuestion && (
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Prüferfrage
              </CardTitle>
              <div className="flex gap-2 flex-wrap items-center">
                <Badge variant={phase === 'question' ? 'secondary' : 'default'}>
                  {phase === 'question' ? 'Frage wird vorgelesen...' : 'Bereit zum Antworten'}
                </Badge>
                {speechSupported && (
                  <Badge variant="outline" className="text-xs">
                    Voice: Browser
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={isSpeaking ? stopSpeaking : handleReadQuestion}
                  disabled={isLoading}
                >
                  {isSpeaking ? (<><VolumeX className="h-4 w-4 mr-1" />Stopp</>) : (<><Volume2 className="h-4 w-4 mr-1" />Vorlesen</>)}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={cn(
              "rounded-lg p-5 border-2 transition-all",
              isSpeaking 
                ? "bg-primary/10 border-primary/40 animate-pulse" 
                : "bg-primary/5 border-primary/20"
            )}>
              <p className="text-lg font-medium leading-relaxed">{currentQuestion.question_text}</p>
            </div>

            {/* Sprachstatus-Anzeige */}
            {isSpeaking && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <Volume2 className="h-5 w-5 text-blue-500 animate-pulse" />
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Der Prüfer stellt die Frage vor...
                </span>
              </div>
            )}

            {isRecording && (
              <div className="space-y-3 premium-reveal">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                  <div className="relative">
                    <div className="h-4 w-4 rounded-full bg-rose-500" />
                    <div className="absolute inset-0 h-4 w-4 rounded-full bg-rose-500 animate-ping" />
                  </div>
                  <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
                    Aufnahme läuft... Sprich jetzt deine Antwort.
                  </span>
                </div>
                {/* Cinematic live-waveform — visual mic feedback */}
                <div className="rounded-lg border border-border-subtle bg-surface-sunken/60 p-3">
                  <OralWaveform active={isRecording} />
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-2 block">
                Deine Antwort
              </label>
              <Textarea
                ref={textareaRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Formuliere deine Antwort wie in einer mündlichen Prüfung... oder nutze die Sprachaufnahme."
                className="min-h-[200px] resize-none"
                disabled={isLoading || isRecording}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Tipp: Strukturiere deine Antwort und verwende Fachbegriffe
              </p>
            </div>

            <div className="flex gap-3">
              {speechSupported && (
                <Button
                  variant={isRecording ? 'destructive' : 'secondary'}
                  onClick={toggleRecording}
                  disabled={isLoading}
                >
                  {isRecording ? (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      Aufnahme beenden
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 mr-2" />
                      Sprachaufnahme
                    </>
                  )}
                </Button>
              )}
              <Button 
                className="flex-1"
                disabled={!answer.trim() || isLoading || isRecording}
                onClick={handleSubmitAnswer}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Antwort abgeben
              </Button>
            </div>
            {speechSupported && micPermission === 'denied' && (
              <p className="text-xs text-destructive mt-2" role="status">
                Mikrofon-Zugriff ist blockiert. Klicke auf das Schloss-Symbol in der Adressleiste, erlaube das Mikrofon und lade die Seite neu. Die Texteingabe bleibt verfügbar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'evaluation' && evaluation && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Bewertung
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={cn("p-4 rounded-lg border text-center", getScoreBg(evaluation.overall_score))}>
              <p className="text-sm text-muted-foreground mb-1">Gesamtbewertung</p>
              <p className={cn("text-4xl font-bold", getScoreColor(evaluation.overall_score))}>
                {Math.round(evaluation.overall_score * 100)}%
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { key: 'fachlichkeit', label: 'Fachlichkeit', score: evaluation.fachlichkeit_score },
                { key: 'struktur', label: 'Struktur', score: evaluation.struktur_score },
                { key: 'begriffssicherheit', label: 'Begriffssicherheit', score: evaluation.begriffssicherheit_score },
                { key: 'praxisbezug', label: 'Praxisbezug', score: evaluation.praxisbezug_score }
              ].map(criterion => (
                <div key={criterion.key} className="p-3 rounded-lg bg-muted/50 border">
                  <p className="text-xs text-muted-foreground mb-1">{criterion.label}</p>
                  <div className="flex items-center gap-2">
                    <Progress value={criterion.score * 100} className="flex-1 h-2" />
                    <span className={cn("text-sm font-medium", getScoreColor(criterion.score))}>
                      {Math.round(criterion.score * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <h4 className="font-medium flex items-center gap-2 mb-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Feedback
                </h4>
                <p className="text-sm text-muted-foreground">{evaluation.feedback}</p>
              </div>

              {evaluation.covered_points?.length > 0 && (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-2 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Gut abgedeckt
                  </h4>
                  <ul className="text-sm space-y-1">
                    {evaluation.covered_points.map((point, idx) => (
                      <li key={idx}>• {point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation.missed_points?.length > 0 && (
                <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-2 text-rose-600 dark:text-rose-400">
                    <XCircle className="h-4 w-4" />
                    Verbesserungspotenzial
                  </h4>
                  <ul className="text-sm space-y-1">
                    {evaluation.missed_points.map((point, idx) => (
                      <li key={idx}>• {point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Musterantwort Toggle */}
              {evaluation.sample_answer && (
                <div className="border rounded-lg overflow-hidden">
                  <Button
                    variant="ghost"
                    className="w-full justify-between p-4 h-auto"
                    onClick={() => setShowSampleAnswer(!showSampleAnswer)}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <FileText className="h-4 w-4" />
                      Musterantwort anzeigen
                    </span>
                    <span className="text-muted-foreground">
                      {showSampleAnswer ? '−' : '+'}
                    </span>
                  </Button>
                  {showSampleAnswer && (
                    <div className="p-4 pt-0 border-t bg-muted/30">
                      <p className="text-sm text-muted-foreground">
                        {evaluation.sample_answer}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Mögliche Nachfrage — Realismus-Regel: mindestens 1 Rückfrage pro Antwort.
                  Wenn die Engine keine Nachfrage liefert, zeigen wir eine generische,
                  damit der Kandidat das Nachfrage-Erlebnis garantiert bekommt. */}
              {(() => {
                const fu = (evaluation.follow_up_question || '').trim();
                const fallback =
                  oralPersona?.stressLevel && oralPersona.stressLevel >= 2
                    ? 'Bitte begründen Sie das konkret an einem Praxisbeispiel — kurz und präzise.'
                    : 'Können Sie das an einem konkreten Praxisbeispiel aus Ihrem Betrieb erläutern?';
                const text = fu || fallback;
                return (
                  <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                    <h4 className="font-medium flex items-center gap-2 mb-2 text-blue-600 dark:text-blue-400">
                      <MessageSquare className="h-4 w-4" />
                      {oralPersona?.examinerMode === 'dual'
                        ? 'Nachfrage Prüfer B'
                        : 'Nachfrage des Prüfers'}
                    </h4>
                    <p className="text-sm italic">"{text}"</p>
                  </div>
                );
              })()}
            </div>

            <Button className="w-full" onClick={handleNextQuestion} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : progress && progress.current >= progress.total ? (
                <>
                  <Trophy className="h-4 w-4 mr-2" />
                  Ergebnisse anzeigen
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Nächste Frage
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === 'results' && session && (
        <Card className="glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              {session.passed ? (
                <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Trophy className="h-10 w-10 text-green-600 dark:text-green-400" />
                </div>
              ) : (
                <div className="h-20 w-20 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <TrendingUp className="h-10 w-10 text-yellow-600 dark:text-yellow-400" />
                </div>
              )}
            </div>
            <CardTitle className="text-2xl">
              {session.passed ? 'Bestanden!' : 'Weiter üben'}
            </CardTitle>
            <CardDescription>
              Deine Leistung in dieser Übungsprüfung
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={cn(
              "p-6 rounded-lg border text-center",
              session.passed ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'
            )}>
              <p className="text-sm text-muted-foreground mb-2">Gesamtergebnis</p>
              <p className={cn(
                "text-5xl font-bold",
                session.passed ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
              )}>
                {Math.round(session.overall_score || 0)}%
              </p>
              <p className="text-sm text-muted-foreground mt-2">Bestanden ab 50%</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Fachlichkeit', score: session.fachlichkeit_score, weight: '35%' },
                { label: 'Struktur', score: session.struktur_score, weight: '20%' },
                { label: 'Begriffssicherheit', score: session.begriffssicherheit_score, weight: '25%' },
                { label: 'Praxisbezug', score: session.praxisbezug_score, weight: '20%' }
              ].map(criterion => (
                <div key={criterion.label} className="p-4 rounded-lg bg-muted/50 border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{criterion.label}</p>
                    <Badge variant="outline" className="text-xs">{criterion.weight}</Badge>
                  </div>
                  <p className={cn("text-2xl font-bold", getScoreColor((criterion.score || 0) / 100))}>
                    {Math.round(criterion.score || 0)}%
                  </p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {session.strengths && session.strengths.length > 0 && (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-3 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Stärken
                  </h4>
                  <ul className="text-sm space-y-2">
                    {session.strengths.slice(0, 4).map((s, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-green-600 dark:text-green-400 mt-1">✓</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {session.weaknesses && session.weaknesses.length > 0 && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-3 text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    Zu verbessern
                  </h4>
                  <ul className="text-sm space-y-2">
                    {session.weaknesses.slice(0, 4).map((w, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-red-600 dark:text-red-400 mt-1">→</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleRestart}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Neue Prüfung
              </Button>
              <Button className="flex-1" onClick={() => navigate('/dashboard')}>
                Zum Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
