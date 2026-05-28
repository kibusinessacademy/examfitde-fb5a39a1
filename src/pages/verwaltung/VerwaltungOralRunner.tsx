/**
 * VerwaltungsOS Oral Bridge v1 — Runner UI
 *
 * Cuts:
 *  - B1a (Bridge text-turn loop + escalation/eval)
 *  - B1b (Server Voice-Modus: STT/TTS Edge-Functions, Push-to-Talk)
 *  - B2  (VibeOS Native Voice Agent: Browser Web Speech API STT + Lovable AI
 *         Gateway via Bridge + SpeechSynthesis TTS — kein externer Provider)
 *  - B3  (VibeOS Webhook: post-session Debrief + Scorecard via HMAC)
 *
 * Anti-Drift: Kein ElevenLabs, kein Convai, kein WebRTC-Provider.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  getVerwaltungDepartmentDna,
  type VerwaltungDepartmentDna,
  type VDOralCase,
} from "@/lib/berufs-ki/occupational-intelligence";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ChevronLeft, MessagesSquare, AlertTriangle, ShieldCheck,
  Loader2, Flame, Mic, MicOff, Volume2, Radio, PhoneOff,
} from "lucide-react";

type TurnEntry = {
  role: "persona" | "user";
  content: string;
  emotion?: string;
  evaluation?: any;
  escalation_delta?: number;
};

const DIM_LABELS: Record<string, string> = {
  buergerverstaendlichkeit: "Bürgerverständlichkeit",
  deeskalation: "Deeskalation",
  fachlichkeit: "Fachlichkeit",
  struktur: "Struktur",
  empathie: "Empathie",
  governance_sicherheit: "Governance",
};

function emotionTone(e?: string) {
  switch (e) {
    case "wütend":
    case "frustriert": return "text-destructive";
    case "gereizt":
    case "verzweifelt":
    case "ängstlich": return "text-warning";
    case "empathisch":
    case "ruhig": return "text-success";
    default: return "text-text-3";
  }
}

// Browser-native Web Speech API capability detection
function getSpeechRecognition(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export default function VerwaltungOralRunner() {
  const { departmentKey = "", oralCaseKey = "" } = useParams();
  const navigate = useNavigate();

  const [dna, setDna] = useState<VerwaltungDepartmentDna | null>(null);
  const [oralCase, setOralCase] = useState<VDOralCase | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnEntry[]>([]);
  const [escalation, setEscalation] = useState(0);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [debriefing, setDebriefing] = useState(false);
  const [debrief, setDebrief] = useState<any>(null);
  const [scorecard, setScorecard] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState<null | boolean>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- Server-Voice (Cut B1b) ----
  const [voiceMode, setVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [personaSpeaking, setPersonaSpeaking] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // ---- VibeOS Native Voice Agent (Cut B2 — Browser Web Speech API) ----
  const [agentMode, setAgentMode] = useState(false);
  const [agentLive, setAgentLive] = useState(false);
  const [agentListening, setAgentListening] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);
  const agentLiveRef = useRef(false);   // mirrors agentLive in event handlers
  const ttsVoiceRef  = useRef<SpeechSynthesisVoice | null>(null);
  const speechSupported = useMemo(() => !!getSpeechRecognition() && typeof window !== "undefined" && "speechSynthesis" in window, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthReady(!!data.session));
  }, []);

  useEffect(() => {
    let alive = true;
    getVerwaltungDepartmentDna(departmentKey).then((d) => {
      if (!alive) return;
      setDna(d);
      const c = d?.oral_training_cases?.find((x) => x.key === oralCaseKey) ?? null;
      setOralCase(c);
    });
    return () => { alive = false; };
  }, [departmentKey, oralCaseKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, debrief]);

  // Pick a German voice once available
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      ttsVoiceRef.current =
        voices.find(v => v.lang?.toLowerCase().startsWith("de")) ??
        voices.find(v => v.default) ??
        voices[0] ?? null;
    };
    pick();
    window.speechSynthesis.addEventListener?.("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", pick);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    audioElRef.current?.pause();
    try { recognitionRef.current?.stop?.(); } catch {}
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // ---- Server-TTS (B1b) ----
  const speak = useCallback(async (text: string) => {
    if (!voiceMode || !text || !sessionId) return;
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) return;
      setPersonaSpeaking(true);
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verwaltung-voice-tts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authSession.access_token}` },
          body: JSON.stringify({ session_id: sessionId, text }),
        },
      );
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        if (resp.status === 503 && detail?.error === "voice_not_configured") {
          toast.error("Voice-Layer nicht konfiguriert", { description: "Text-Modus bleibt nutzbar." });
          setVoiceMode(false);
        }
        setPersonaSpeaking(false);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (audioElRef.current) audioElRef.current.pause();
      const audio = new Audio(url);
      audioElRef.current = audio;
      audio.onended = () => { setPersonaSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPersonaSpeaking(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (e) {
      console.error("[verwaltung-tts] play error", e);
      setPersonaSpeaking(false);
    }
  }, [voiceMode, sessionId]);

  // ---- Server STT push-to-talk (B1b) ----
  const startRecording = async () => {
    if (isRecording || loading || isTranscribing || !!debrief) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await transcribeAndSend(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e: any) {
      toast.error("Mikrofon-Zugriff verweigert", { description: e?.message });
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);
    mediaRecorderRef.current?.stop();
  };

  const transcribeAndSend = async (blob: Blob) => {
    if (!sessionId) return;
    setIsTranscribing(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) throw new Error("Auth abgelaufen");
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verwaltung-voice-stt?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm", Authorization: `Bearer ${authSession.access_token}` },
          body: blob,
        },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (resp.status === 503 && data?.error === "voice_not_configured") {
          toast.error("Voice-Layer nicht konfiguriert");
          setVoiceMode(false);
        } else {
          toast.error("Transkription fehlgeschlagen", { description: data?.error });
        }
        return;
      }
      const transcript = (data?.transcript ?? "").trim();
      if (!transcript) { toast("Nichts erkannt. Bitte nochmal sprechen."); return; }
      await handleSend(transcript);
    } catch (e: any) {
      toast.error("Sprach-Fehler", { description: e?.message });
    } finally {
      setIsTranscribing(false);
    }
  };

  async function invokeBridge(payload: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke("verwaltung-oral-bridge", { body: payload });
    if (error) throw new Error(error.message || "BRIDGE_ERROR");
    if (data?.error) throw new Error(`${data.error}${data.detail ? `: ${data.detail}` : ""}`);
    return data;
  }

  // ---- VibeOS Native Voice Agent: SpeechSynthesis TTS ----
  const agentSpeak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) { resolve(); return; }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "de-DE";
        if (ttsVoiceRef.current) u.voice = ttsVoiceRef.current;
        u.rate = 1.0; u.pitch = 1.0;
        u.onstart = () => setAgentSpeaking(true);
        u.onend = () => { setAgentSpeaking(false); resolve(); };
        u.onerror = () => { setAgentSpeaking(false); resolve(); };
        window.speechSynthesis.speak(u);
      } catch { setAgentSpeaking(false); resolve(); }
    });
  }, []);

  // ---- VibeOS Native Voice Agent: SpeechRecognition (continuous, single utterance per cycle) ----
  const startAgentListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR || !agentLiveRef.current) return;
    try {
      const rec = new SR();
      rec.lang = "de-DE";
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      setAgentListening(true);
      rec.onresult = async (e: any) => {
        const transcript = String(e?.results?.[0]?.[0]?.transcript ?? "").trim();
        setAgentListening(false);
        if (!transcript) {
          // re-arm
          if (agentLiveRef.current) setTimeout(() => startAgentListening(), 250);
          return;
        }
        await handleSend(transcript);
        // after persona response speaks (handled in handleSend), re-arm in onend (see agentSpeak chain)
      };
      rec.onerror = (e: any) => {
        setAgentListening(false);
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          toast.error("Mikrofon-Zugriff verweigert");
          agentLiveRef.current = false; setAgentLive(false);
          return;
        }
        if (agentLiveRef.current) setTimeout(() => startAgentListening(), 400);
      };
      rec.onend = () => {
        setAgentListening(false);
      };
      rec.start();
    } catch (err: any) {
      setAgentListening(false);
      toast.error("Spracherkennung-Fehler", { description: err?.message });
    }
  }, []);

  const stopAgent = useCallback(() => {
    agentLiveRef.current = false;
    setAgentLive(false);
    setAgentListening(false);
    try { recognitionRef.current?.stop?.(); } catch {}
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setAgentSpeaking(false);
  }, []);

  const startAgent = useCallback(async () => {
    if (!sessionId) { toast.error("Erst Simulation starten"); return; }
    if (!speechSupported) {
      toast.error("Browser unterstützt Web Speech API nicht", { description: "Bitte Chrome oder Edge verwenden." });
      return;
    }
    try {
      // Prime mic permission early
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (e: any) {
      toast.error("Mikrofon-Zugriff verweigert", { description: e?.message });
      return;
    }
    agentLiveRef.current = true;
    setAgentLive(true);
    // Speak last persona utterance (if any) so user has context, then listen
    const lastPersona = [...turns].reverse().find(t => t.role === "persona");
    if (lastPersona?.content) await agentSpeak(lastPersona.content);
    if (agentLiveRef.current) startAgentListening();
  }, [sessionId, speechSupported, turns, agentSpeak, startAgentListening]);

  async function handleStart() {
    setErrorMsg(null);
    setStarting(true);
    try {
      const data = await invokeBridge({
        action: "start",
        department_key: departmentKey,
        oral_case_key: oralCaseKey,
        persona: "buerger_default",
      });
      setSessionId(data.session_id);
      setEscalation(data.escalation_state ?? 0);
      setTurns([{ role: "persona", content: data.persona_utterance, emotion: data.persona_emotion }]);
      if (voiceMode && data.persona_utterance) {
        setTimeout(() => { void speakWith(data.session_id, data.persona_utterance); }, 50);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  const speakWith = async (sid: string, text: string) => {
    if (!voiceMode || !text) return;
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) return;
      setPersonaSpeaking(true);
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verwaltung-voice-tts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authSession.access_token}` },
          body: JSON.stringify({ session_id: sid, text }),
        },
      );
      if (!resp.ok) { setPersonaSpeaking(false); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (audioElRef.current) audioElRef.current.pause();
      const audio = new Audio(url);
      audioElRef.current = audio;
      audio.onended = () => { setPersonaSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPersonaSpeaking(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch { setPersonaSpeaking(false); }
  };

  async function handleSend(overrideText?: string) {
    const msg = (overrideText ?? input).trim();
    if (!sessionId || !msg) return;
    setErrorMsg(null);
    if (!overrideText) setInput("");
    setTurns((t) => [...t, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const data = await invokeBridge({ action: "turn", session_id: sessionId, user_message: msg });
      setEscalation(data.escalation_state ?? 0);
      setTurns((t) => {
        const updated = [...t];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === "user") { updated[i] = { ...updated[i], evaluation: data.evaluation }; break; }
        }
        updated.push({
          role: "persona",
          content: data.persona_utterance,
          emotion: data.persona_emotion,
          escalation_delta: data.escalation_delta,
        });
        return updated;
      });
      if (voiceMode && data.persona_utterance) {
        void speak(data.persona_utterance);
      }
      if (agentLiveRef.current && data.persona_utterance) {
        await agentSpeak(data.persona_utterance);
        if (agentLiveRef.current && !debrief) startAgentListening();
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDebrief() {
    if (!sessionId) return;
    if (agentLiveRef.current) stopAgent();
    setErrorMsg(null);
    setDebriefing(true);
    try {
      const data = await invokeBridge({ action: "debrief", session_id: sessionId });
      setDebrief(data.debrief);
      setScorecard(data.scorecard);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDebriefing(false);
    }
  }

  if (authReady === false) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-text-1 mb-3">Anmeldung erforderlich</h1>
        <p className="text-text-2 mb-6">
          Verwaltungs-Simulationen sind authentifizierungspflichtig (Trainings-Daten gehören dir).
        </p>
        <Button onClick={() => navigate("/auth")}>Anmelden</Button>
      </div>
    );
  }

  if (!dna || !oralCase) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-10 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const conflict = oralCase.conflict_level ?? "medium";
  const escPct = (escalation / 5) * 100;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <Link to="/branchen/verwaltung" className="inline-flex items-center text-sm text-text-2 hover:text-text-1 mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" /> Zurück zur Fachbereichs-Übersicht
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="outline" className="mb-2">{dna.category} · {dna.department_name}</Badge>
          <h1 className="text-2xl md:text-3xl font-bold text-text-1">{oralCase.scenario_title}</h1>
          <div className="flex flex-wrap gap-2 mt-2 text-sm text-text-2">
            {oralCase.role_counterpart && <span>Gegenüber: <strong className="text-text-1">{oralCase.role_counterpart}</strong></span>}
            <span>· Konflikt: <strong className={conflict === "high" ? "text-destructive" : conflict === "medium" ? "text-warning" : "text-text-1"}>{conflict}</strong></span>
            {oralCase.legal_complexity && <span>· Recht: {oralCase.legal_complexity}</span>}
          </div>
          {oralCase.training_focus && (
            <p className="text-sm text-text-3 mt-2 italic">Trainings-Fokus: {oralCase.training_focus}</p>
          )}
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2">
            {voiceMode ? <Mic className="h-4 w-4 text-primary" /> : <MicOff className="h-4 w-4 text-text-3" />}
            <Label htmlFor="vos-voice-mode" className="text-xs cursor-pointer select-none">Voice (Server STT/TTS)</Label>
            <Switch
              id="vos-voice-mode"
              checked={voiceMode}
              disabled={agentMode || agentLive}
              onCheckedChange={(v) => {
                setVoiceMode(v);
                if (!v && audioElRef.current) audioElRef.current.pause();
              }}
            />
            {personaSpeaking && (
              <span className="ml-1 inline-flex items-center gap-1 text-xs text-primary">
                <Volume2 className="h-3.5 w-3.5 animate-pulse" /> Persona spricht
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2">
            <Radio className={`h-4 w-4 ${agentMode ? "text-primary" : "text-text-3"}`} />
            <Label htmlFor="vos-agent-mode" className="text-xs cursor-pointer select-none">
              VibeOS Voice Agent {!speechSupported && "(nicht verfügbar)"}
            </Label>
            <Switch
              id="vos-agent-mode"
              checked={agentMode}
              disabled={voiceMode || agentLive || !speechSupported}
              onCheckedChange={(v) => setAgentMode(v)}
            />
            {agentLive && (
              <span className="ml-1 inline-flex items-center gap-1 text-xs text-primary">
                <Volume2 className="h-3.5 w-3.5 animate-pulse" />
                {agentSpeaking ? "Persona spricht" : agentListening ? "Hört zu" : "Pause"}
              </span>
            )}
          </div>
        </div>
      </div>

      {!sessionId ? (
        <Card className="p-8 text-center bg-surface-1">
          <MessagesSquare className="h-10 w-10 mx-auto text-primary mb-3" />
          <h2 className="text-lg font-semibold text-text-1 mb-2">Simulation starten</h2>
          <p className="text-text-2 mb-6 max-w-xl mx-auto">
            Du übernimmst die Rolle des Verwaltungsmitarbeiters. Das Gegenüber reagiert dynamisch auf
            deine Antworten — Eskalation, Emotion und Governance-Bewertung laufen live mit.
            {voiceMode && " Server-Voice aktiv: Push-to-Talk + Persona-Stimme."}
            {agentMode && " VibeOS Native Voice Agent aktiv: Browser-Spracherkennung + lokale Sprachausgabe."}
          </p>
          <Button size="lg" onClick={handleStart} disabled={starting}>
            {starting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Wird vorbereitet…</> : "Simulation starten"}
          </Button>
          {errorMsg && <p className="text-sm text-destructive mt-4">{errorMsg}</p>}
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Conversation */}
          <Card className="flex flex-col bg-surface-1 overflow-hidden" style={{ height: "70vh" }}>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {turns.map((t, i) => (
                <div key={i} className={t.role === "persona" ? "flex" : "flex justify-end"}>
                  <div className={`max-w-[80%] rounded-lg p-3 ${t.role === "persona" ? "bg-surface-2 text-text-1" : "bg-primary text-primary-foreground"}`}>
                    <div className="text-xs opacity-70 mb-1 flex items-center gap-2">
                      {t.role === "persona" ? (oralCase.role_counterpart ?? "Persona") : "Du"}
                      {t.emotion && <span className={emotionTone(t.emotion)}>· {t.emotion}</span>}
                      {typeof t.escalation_delta === "number" && t.escalation_delta !== 0 && (
                        <span className={t.escalation_delta > 0 ? "text-destructive" : "text-success"}>
                          {t.escalation_delta > 0 ? `+${t.escalation_delta}` : t.escalation_delta} Esk.
                        </span>
                      )}
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{t.content}</div>
                    {t.role === "user" && t.evaluation?.kurz_feedback && (
                      <div className="text-xs mt-2 pt-2 border-t border-primary-foreground/20 opacity-90">
                        💬 {t.evaluation.kurz_feedback}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-text-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Persona reagiert…
                </div>
              )}
              {isTranscribing && (
                <div className="flex items-center gap-2 text-text-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Transkribiere Sprachaufnahme…
                </div>
              )}
              {debrief && (
                <Card className="mt-4 p-4 bg-surface-2 border-primary/30">
                  <h3 className="font-semibold text-text-1 mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Debrief — {debrief.overall_outcome}
                  </h3>
                  <DebriefBlock label="Stärken" items={debrief.key_strengths} tone="success" />
                  <DebriefBlock label="Risiken" items={debrief.key_risks} tone="destructive" />
                  <DebriefBlock label="Typische Fehler" items={debrief.typische_fehler} tone="warning" />
                  <DebriefBlock label="Eskalationsmomente" items={debrief.eskalationsmomente} tone="warning" />
                  <DebriefBlock label="Alternative Formulierungen" items={debrief.alternative_formulierungen} tone="muted" />
                  {debrief.buergerwirkung && <p className="text-sm text-text-2 mt-2"><strong className="text-text-1">Bürgerwirkung:</strong> {debrief.buergerwirkung}</p>}
                  {debrief.governance_wirkung && <p className="text-sm text-text-2 mt-1"><strong className="text-text-1">Governance:</strong> {debrief.governance_wirkung}</p>}
                  {debrief.next_focus && <p className="text-sm text-text-2 mt-2"><strong className="text-text-1">Nächster Trainingsfokus:</strong> {debrief.next_focus}</p>}
                </Card>
              )}
            </div>
            <div className="border-t border-border p-3 flex gap-2">
              {agentMode ? (
                <div className="flex-1 flex items-center justify-center">
                  {agentLive ? (
                    <Button size="lg" variant="destructive" onClick={stopAgent} className="min-w-[220px]">
                      <PhoneOff className="h-5 w-5 mr-2" /> Voice Agent beenden
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      variant="petrol"
                      onClick={startAgent}
                      disabled={!!debrief || !speechSupported}
                      className="min-w-[220px]"
                    >
                      <Radio className="h-5 w-5 mr-2" /> Voice Agent starten
                    </Button>
                  )}
                </div>
              ) : voiceMode ? (
                <div className="flex-1 flex items-center justify-center">
                  <Button
                    size="lg"
                    variant={isRecording ? "destructive" : "petrol"}
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={isRecording ? stopRecording : undefined}
                    onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                    onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                    disabled={loading || isTranscribing || personaSpeaking || !!debrief}
                    className="min-w-[220px] select-none"
                  >
                    {isRecording ? (
                      <><Mic className="h-5 w-5 mr-2 animate-pulse" /> Aufnahme läuft – loslassen zum Senden</>
                    ) : isTranscribing ? (
                      <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Transkribiere…</>
                    ) : personaSpeaking ? (
                      <><Volume2 className="h-5 w-5 mr-2" /> Persona spricht…</>
                    ) : (
                      <><Mic className="h-5 w-5 mr-2" /> Push-to-Talk – gedrückt halten</>
                    )}
                  </Button>
                </div>
              ) : (
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                  placeholder={debrief ? "Simulation abgeschlossen." : "Deine Antwort als Verwaltungsmitarbeiter… (Cmd/Ctrl+Enter)"}
                  disabled={loading || !!debrief}
                  rows={2}
                  className="resize-none"
                />
              )}
              <div className="flex flex-col gap-2">
                {!voiceMode && !agentMode && (
                  <Button onClick={() => handleSend()} disabled={loading || !input.trim() || !!debrief}>Senden</Button>
                )}
                <Button variant="outline" onClick={handleDebrief} disabled={debriefing || !!debrief || turns.length < 3}>
                  {debriefing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Debrief"}
                </Button>
              </div>
            </div>
            {errorMsg && <p className="text-sm text-destructive px-4 pb-3">{errorMsg}</p>}
          </Card>

          {/* Side Panel */}
          <div className="space-y-4">
            <Card className="p-4 bg-surface-1">
              <h3 className="text-sm font-semibold text-text-2 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-destructive" /> Eskalations-Meter
              </h3>
              <Progress value={escPct} className="h-2" />
              <div className="flex justify-between text-xs text-text-3 mt-1">
                <span>0 ruhig</span>
                <span>Stufe {escalation}/5</span>
                <span>5 kritisch</span>
              </div>
            </Card>

            {scorecard?.per_dim && (
              <Card className="p-4 bg-surface-1">
                <h3 className="text-sm font-semibold text-text-2 uppercase tracking-wide mb-3">Scorecard</h3>
                <div className="text-3xl font-bold text-text-1 mb-3">{scorecard.overall}<span className="text-base text-text-3"> / 100</span></div>
                <div className="space-y-2">
                  {Object.entries(scorecard.per_dim).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-xs text-text-2 mb-0.5">
                        <span>{DIM_LABELS[k] ?? k}</span><span>{Number(v)}</span>
                      </div>
                      <Progress value={Number(v)} className="h-1.5" />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-3 mt-3">
                  Gewichtet für Cluster: <strong>{scorecard.category}</strong>
                </p>
              </Card>
            )}

            <Card className="p-4 bg-surface-1 text-xs text-text-3">
              <p className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                Simulation — keine reale Bürgerkommunikation. Alle Eingaben werden in deinem Trainings-Verlauf gespeichert.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function DebriefBlock({ label, items, tone }: { label: string; items?: string[]; tone: "success"|"destructive"|"warning"|"muted" }) {
  if (!items || items.length === 0) return null;
  const cls =
    tone === "success" ? "text-success" :
    tone === "destructive" ? "text-destructive" :
    tone === "warning" ? "text-warning" : "text-text-3";
  return (
    <div className="mb-2">
      <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${cls}`}>{label}</div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-text-2"><span className="text-text-3 mr-1">·</span>{it}</li>
        ))}
      </ul>
    </div>
  );
}
