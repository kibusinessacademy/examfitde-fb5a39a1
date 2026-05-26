// ConversationOS — Live Run Page
// Streaming chat with state-meter, painpoint indicator, and end-session.
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowLeft, Send, Square, Loader2, Activity } from 'lucide-react';

type State = { trust: number; tension: number; confidence: number; rapport: number };
type Msg = { role: 'user' | 'assistant'; content: string; painpoint?: string | null };

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Start session on mount
  useEffect(() => {
    if (!scenarioId) return;
    (async () => {
      try {
        // Read context overrides from sessionStorage (set by VerticalModulePage)
        let context_overrides: any = undefined;
        try {
          const raw = sessionStorage.getItem(`conv_os_ctx_${scenarioId}`);
          if (raw) context_overrides = JSON.parse(raw);
        } catch { /* */ }

        const { data, error } = await supabase.functions.invoke('conversation-os-start', {
          body: { scenario_id: scenarioId, context_overrides },
        });
        if (error) throw error;
        setSessionId(data.session_id);
        setScenario(data.scenario);
        setState(data.conversation_state);
        setMessages([{ role: 'assistant', content: data.opening }]);
      } catch (e: any) {
        toast.error('Konnte Session nicht starten', { description: e.message });
        navigate('/os/hr-interview');
      } finally {
        setIsStarting(false);
      }
    })();
  }, [scenarioId, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isStreaming]);

  const send = async () => {
    if (!input.trim() || !sessionId || isStreaming) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }, { role: 'assistant', content: '' }]);
    setIsStreaming(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conversation-os-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ session_id: sessionId, message: userMsg }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) toast.error('Zu viele Anfragen. Kurz warten.');
        else if (resp.status === 402) toast.error('AI-Guthaben aufgebraucht.');
        else toast.error('Server-Fehler');
        setMessages((prev) => prev.slice(0, -1));
        setIsStreaming(false);
        return;
      }

      // Read state meta from headers
      const ppHeader = resp.headers.get('x-conv-painpoint');
      const stateHeader = resp.headers.get('x-conv-state');
      if (ppHeader) setActivePainpoint(ppHeader);
      if (stateHeader) {
        try { setState(JSON.parse(stateHeader)); } catch { /* */ }
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
    } catch (e: any) {
      toast.error('Verbindungsfehler', { description: e.message });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  };

  const endSession = async () => {
    if (!sessionId) return;
    setIsEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke('conversation-os-debrief', {
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
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/os/hr-interview"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">{scenario?.title ?? 'Session'}</h1>
              <p className="text-xs text-muted-foreground truncate">{scenario?.character_brief?.name ?? scenario?.vertical_module}</p>
            </div>
          </div>
          <Button onClick={endSession} disabled={isEnding || isStreaming || messages.length < 3} variant="default" size="sm">
            {isEnding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
            Beenden &amp; Debrief
          </Button>
        </div>

        {/* State Meter */}
        <div className="container mx-auto px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <StateBar label="Trust" value={state.trust} tone="primary" />
          <StateBar label="Tension" value={state.tension} tone="destructive" inverted />
          <StateBar label="Confidence" value={state.confidence} tone="primary" />
          <StateBar label="Rapport" value={state.rapport} tone="primary" />
        </div>

        {activePainpoint && (
          <div className="container mx-auto px-4 pb-2">
            <Badge variant="outline" className="gap-1 text-xs">
              <Activity className="h-3 w-3" />
              Painpoint aktiv: {activePainpoint}
            </Badge>
          </div>
        )}
      </header>

      {/* Messages */}
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
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content || (isStreaming && i === messages.length - 1 ? '...' : '')}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 max-w-3xl">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ihre Antwort..."
              disabled={isStreaming}
              className="min-h-[60px] resize-none"
            />
            <Button onClick={send} disabled={!input.trim() || isStreaming} size="lg" className="self-end">
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Enter = senden · Shift+Enter = neue Zeile</p>
        </div>
      </div>
    </div>
  );
}

function StateBar({ label, value, tone, inverted }: { label: string; value: number; tone: 'primary' | 'destructive'; inverted?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between text-muted-foreground"><span>{label}</span><span>{pct}</span></div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}
