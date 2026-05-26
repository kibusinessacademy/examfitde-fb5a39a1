// ConversationOS — Live Run Page (Phase 2 Cut 1: Voice-native)
// Push-to-talk + TTS playback + silence-press timer + quality-gate UX.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Send, Square, Loader2, Activity, Mic, MicOff, Volume2 } from 'lucide-react';

type State = { trust: number; tension: number; confidence: number; rapport: number };
type Msg = { role: 'user' | 'assistant'; content: string; painpoint?: string | null };

const SILENCE_PRESS_AFTER_MS = 8000;

export default function ConversationOSRunPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [state, setState] = useState<State>({ trust: 0.5, tension: 0.3, confidence: 0.5, rapport: 0.5 });
  const [activePainpoint, setActivePainpoint] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const [isEnding, setIsEnding] = useState(false);
  const [aborted, setAborted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice
  const [voiceMode, setVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [characterSpeaking, setCharacterSpeaking] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<number | null>(null);

  // Start session on mount
  useEffect(() => {
    if (!scenarioId) return;
    (async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession) {
          toast.error('Bitte einloggen', { description: 'Für den HR-Interview-Pilot ist ein Login erforderlich.' });
          navigate(`/auth?returnTo=${encodeURIComponent(`/os/hr-interview/run/${scenarioId}`)}`);
          return;
        }

        let context_overrides: any = undefined;
        try {
          const raw = sessionStorage.getItem(`conv_os_ctx_${scenarioId}`);
          if (raw) context_overrides = JSON.parse(raw);
        } catch { /* */ }

        const { data, error } = await supabase.functions.invoke('conversation-os-start', {
          body: { scenario_id: scenarioId, context_overrides },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setSessionId(data.session_id);
        setScenario(data.scenario);
        setState(data.conversation_state);
        setMessages([{ role: 'assistant', content: data.opening }]);
      } catch (e: any) {
        console.error('[conv-os-start] failed', e);
        toast.error('Konnte Session nicht starten', { description: e?.message ?? 'Unbekannter Fehler' });
        navigate('/os/hr-interview');
      } finally {
        setIsStarting(false);
      }
    })();
  }, [scenarioId, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isStreaming]);

  // ---- TTS playback ----
  const speak = useCallback(async (text: string, voiceId?: string | null) => {
    if (!voiceMode || !text || !sessionId) return;
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) return;
      setCharacterSpeaking(true);
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conversation-os-tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.access_token}`,
        },
        body: JSON.stringify({ session_id: sessionId, text, voice_id: voiceId || undefined }),
      });
      if (!resp.ok) {
        console.warn('[tts] failed', resp.status);
        setCharacterSpeaking(false);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (audioElRef.current) {
        audioElRef.current.pause();
      }
      const audio = new Audio(url);
      audioElRef.current = audio;
      audio.onended = () => {
        setCharacterSpeaking(false);
        URL.revokeObjectURL(url);
        startSilenceTimer();
      };
      audio.onerror = () => {
        setCharacterSpeaking(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e) {
      console.error('[tts] play error', e);
      setCharacterSpeaking(false);
    }
  }, [voiceMode, sessionId]);

  // ---- Silence-pressure timer ----
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };
  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    if (aborted || !voiceMode) return;
    silenceTimerRef.current = window.setTimeout(() => {
      // Press the user
      toast('Der Charakter wartet…', { description: '"Ist die Frage unklar?"', duration: 4000 });
      // Optional small state nudge handled server-side on next turn via tension
    }, SILENCE_PRESS_AFTER_MS);
  }, [aborted, voiceMode]);

  useEffect(() => () => { clearSilenceTimer(); audioElRef.current?.pause(); }, []);

  // ---- Push-to-talk ----
  const startRecording = async () => {
    if (isRecording || isStreaming || isTranscribing || aborted) return;
    clearSilenceTimer();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAndSend(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e: any) {
      toast.error('Mikrofon-Zugriff verweigert', { description: e?.message });
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);
    mediaRecorderRef.current?.stop();
  };

  const transcribeAndSend = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) throw new Error('Auth abgelaufen');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conversation-os-stt`, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'audio/webm',
          Authorization: `Bearer ${authSession.access_token}`,
        },
        body: blob,
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error('Transkription fehlgeschlagen', { description: data?.error });
        return;
      }
      const transcript = (data?.transcript ?? '').trim();
      if (!transcript) {
        toast('Nichts erkannt. Bitte nochmal sprechen.');
        return;
      }
      await sendMessage(transcript);
    } catch (e: any) {
      toast.error('Sprach-Fehler', { description: e?.message });
    } finally {
      setIsTranscribing(false);
    }
  };

  // ---- Send (text or transcript) ----
  const sendMessage = async (text: string) => {
    if (!text.trim() || !sessionId || isStreaming || aborted) return;
    clearSilenceTimer();
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setIsStreaming(true);

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conversation-os-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) toast.error('Zu viele Anfragen. Kurz warten.');
        else if (resp.status === 402) toast.error('AI-Guthaben aufgebraucht.');
        else toast.error('Server-Fehler');
        setMessages((prev) => prev.slice(0, -1));
        setIsStreaming(false);
        return;
      }

      const ppHeader = resp.headers.get('x-conv-painpoint');
      const stateHeader = resp.headers.get('x-conv-state');
      const voiceIdHeader = resp.headers.get('x-conv-voice-id');
      const abortedHeader = resp.headers.get('x-conv-aborted');
      const qualityGateHeader = resp.headers.get('x-conv-quality-gate');

      if (ppHeader) setActivePainpoint(ppHeader);
      if (stateHeader) {
        try { setState(JSON.parse(stateHeader)); } catch { /* */ }
      }
      if (qualityGateHeader) {
        toast.warning('Charakter reagiert ablehnend', {
          description: qualityGateHeader === 'silence' ? 'Sie haben nicht geantwortet.' :
                       qualityGateHeader === 'gibberish' ? 'Das war keine echte Antwort.' :
                       'Antwort zu kurz.',
        });
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assembled = '';
      let done = false;

      while (!done) {
        const r = await reader.read();
        if (r.done) break;
        buf += decoder.decode(r.value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assembled += delta;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: assembled, painpoint: ppHeader };
                return next;
              });
            }
          } catch {
            buf = line + '\n' + buf;
            break;
          }
        }
      }

      // Voice playback (after stream completes — synthesise full sentence)
      if (assembled && voiceMode) {
        await speak(assembled, voiceIdHeader);
      } else {
        startSilenceTimer();
      }

      if (abortedHeader === '1') {
        setAborted(true);
        toast.error('Der Charakter hat das Gespräch beendet.', {
          description: 'Vertrauensverlust durch Nicht-Antwort. Bitte starten Sie das Debrief.',
        });
      }
    } catch (e: any) {
      toast.error('Verbindungsfehler', { description: e.message });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  };

  const sendText = async () => {
    if (!input.trim()) return;
    const t = input.trim();
    setInput('');
    await sendMessage(t);
  };

  const endSession = async () => {
    if (!sessionId) return;
    setIsEnding(true);
    audioElRef.current?.pause();
    clearSilenceTimer();
    try {
      const { error } = await supabase.functions.invoke('conversation-os-debrief', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      navigate(`/os/hr-interview/debrief/${sessionId}`);
    } catch (e: any) {
      toast.error('Debrief fehlgeschlagen', { description: e.message });
      setIsEnding(false);
    }
  };

  if (isStarting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/os/hr-interview"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">{scenario?.title ?? 'Session'}</h1>
              <p className="text-xs text-muted-foreground truncate">{scenario?.character_brief?.name ?? scenario?.vertical_module}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Mic className={`h-3.5 w-3.5 ${voiceMode ? 'text-primary' : 'text-muted-foreground'}`} />
              <Label htmlFor="voice-mode" className="text-xs cursor-pointer select-none">Voice</Label>
              <Switch id="voice-mode" checked={voiceMode} onCheckedChange={setVoiceMode} />
            </div>
            <Button onClick={endSession} disabled={isEnding || isStreaming || messages.length < 3} variant="default" size="sm">
              {isEnding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
              Beenden &amp; Debrief
            </Button>
          </div>
        </div>

        <div className="container mx-auto px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <StateBar label="Trust" value={state.trust} />
          <StateBar label="Tension" value={state.tension} />
          <StateBar label="Confidence" value={state.confidence} />
          <StateBar label="Rapport" value={state.rapport} />
        </div>

        {(activePainpoint || characterSpeaking) && (
          <div className="container mx-auto px-4 pb-2 flex items-center gap-2 flex-wrap">
            {activePainpoint && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Activity className="h-3 w-3" />
                {activePainpoint}
              </Badge>
            )}
            {characterSpeaking && (
              <Badge variant="secondary" className="gap-1 text-xs animate-pulse">
                <Volume2 className="h-3 w-3" />
                Charakter spricht…
              </Badge>
            )}
          </div>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-6 max-w-3xl space-y-4">
          {messages.map((m, i) => (
            <Card key={i} className={`p-4 ${m.role === 'user' ? 'ml-12 bg-primary/5 border-primary/20' : 'mr-12'}`}>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
                {m.role === 'user' ? 'Sie' : scenario?.character_brief?.name ?? 'Charakter'}
                {m.painpoint && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">{m.painpoint}</Badge>
                )}
              </div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content || (isStreaming && i === messages.length - 1 ? '…' : '')}</div>
            </Card>
          ))}
          {aborted && (
            <Card className="p-4 border-destructive/40 bg-destructive/5">
              <p className="text-sm text-destructive font-medium">Gespräch vom Charakter beendet.</p>
              <p className="text-xs text-muted-foreground mt-1">Bitte starten Sie das Debrief, um die kritischen Momente zu analysieren.</p>
            </Card>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 max-w-3xl">
          {voiceMode ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => isRecording && stopRecording()}
                onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                disabled={isStreaming || isTranscribing || characterSpeaking || aborted}
                className={`relative h-20 w-20 rounded-full flex items-center justify-center transition-all
                  ${isRecording
                    ? 'bg-destructive text-destructive-foreground scale-110 shadow-lg ring-4 ring-destructive/30 animate-pulse'
                    : 'bg-primary text-primary-foreground hover:scale-105 shadow-md disabled:opacity-50 disabled:scale-100'
                  }`}
                aria-label={isRecording ? 'Aufnahme stoppen' : 'Sprechen — gedrückt halten'}
              >
                {isTranscribing
                  ? <Loader2 className="h-8 w-8 animate-spin" />
                  : isRecording
                    ? <MicOff className="h-8 w-8" />
                    : <Mic className="h-8 w-8" />}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                {aborted ? 'Gespräch beendet' :
                 characterSpeaking ? 'Charakter spricht…' :
                 isTranscribing ? 'Transkribiere…' :
                 isStreaming ? 'Charakter denkt nach…' :
                 isRecording ? 'Loslassen zum Senden' :
                 'Halten zum Sprechen'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                  placeholder={aborted ? 'Gespräch beendet.' : 'Ihre Antwort…'}
                  disabled={isStreaming || aborted}
                  className="min-h-[60px] resize-none"
                />
                <Button onClick={sendText} disabled={!input.trim() || isStreaming || aborted} size="lg" className="self-end">
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Enter = senden · Shift+Enter = neue Zeile · Voice-Toggle oben rechts für mündlichen Modus</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StateBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between text-muted-foreground"><span>{label}</span><span>{pct}</span></div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}
