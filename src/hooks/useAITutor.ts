import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// AI Tutor Governance Modes (SSOT - mirrors backend)
export const AI_MODES = {
  LEARNING: 'learning',
  PRACTICE: 'practice',
  EXAM: 'exam'
} as const;

export const AI_ROLES = {
  EXPLAINER: 'explainer',
  COACH: 'coach',
  EXAMINER: 'examiner',
  FEEDBACK: 'feedback',
  EXAM_TRANSFER: 'exam_transfer'
} as const;

export type AIMode = typeof AI_MODES[keyof typeof AI_MODES];
export type AIRole = typeof AI_ROLES[keyof typeof AI_ROLES];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  wasBlocked?: boolean;
}

export interface AITutorContext {
  // SSOT: only IDs are sent to server; server loads text from DB
  curriculumId?: string;
  learningFieldId?: string;
  competencyId?: string;
  lessonId?: string;
  lessonStep?: string;
  miniCheckScore?: number;
  // Mastery context: user_id + curriculum_id for server-side readiness/weakness loading
  masteryUserId?: string;
  masteryCurriculumId?: string;
  // Deprecated: text fields ignored by server, kept for backward compat
  curriculumTitle?: string;
  learningFieldTitle?: string;
  competencyTitle?: string;
  lessonTitle?: string;
}

interface UseAITutorOptions {
  mode: AIMode;
  role?: AIRole;
  sessionId?: string;
  sessionType?: 'learning' | 'practice' | 'exam' | 'lesson';
  context?: AITutorContext;
}

const TUTOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-tutor`;

export function useAITutor({
  mode,
  role: initialRole = AI_ROLES.EXPLAINER,
  sessionId,
  sessionType = 'learning',
  context: initialContext = {}
}: UseAITutorOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentRole, setCurrentRole] = useState<AIRole>(initialRole);
  const [context, setContext] = useState<AITutorContext>(initialContext);
  const { toast } = useToast();

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;

    const userMessage: ChatMessage = { role: 'user', content: message, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Nicht authentifiziert');
      }

      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));

      const mastery_context = context.masteryUserId && context.masteryCurriculumId
        ? { user_id: context.masteryUserId, curriculum_id: context.masteryCurriculumId }
        : undefined;

      const resp = await fetch(TUTOR_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ message, mode, role: currentRole, sessionId, sessionType, conversationHistory, context, mastery_context }),
      });

      // Handle non-streaming error responses
      if (!resp.ok) {
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const errData = await resp.json();
          throw new Error(errData.error || `Error ${resp.status}`);
        }
        throw new Error(`Error ${resp.status}`);
      }

      const contentType = resp.headers.get("content-type") || "";

      // Handle SSE streaming response
      if (contentType.includes("text/event-stream") && resp.body) {
        let assistantContent = "";
        let wasBlocked = false;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const upsertAssistant = (text: string) => {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: text } : m));
            }
            return [...prev, { role: "assistant", content: text, timestamp: new Date() }];
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                assistantContent += content;
                upsertAssistant(assistantContent);
              }
            } catch { /* partial JSON, wait for more */ }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          for (let raw of buffer.split("\n")) {
            if (!raw || !raw.startsWith("data: ")) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                assistantContent += content;
                upsertAssistant(assistantContent);
              }
            } catch { /* ignore */ }
          }
        }

        if (!assistantContent) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'Keine Antwort erhalten.',
            timestamp: new Date(),
          }]);
        }
      } else {
        // Fallback: JSON response (e.g. blocked in exam mode)
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
          wasBlocked: data.wasBlocked,
        }]);
        if (data.wasBlocked) {
          toast({ title: 'Hinweis', description: 'Im Prüfungsmodus ist keine inhaltliche Hilfe verfügbar.' });
        }
      }
    } catch (error) {
      console.error('AI Tutor error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Entschuldigung, es gab einen Fehler. Bitte versuche es erneut.',
        timestamp: new Date(),
      }]);
      toast({ title: 'Fehler', description: 'Der AI-Tutor konnte nicht antworten.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [messages, mode, currentRole, sessionId, sessionType, context, toast]);

  const clearMessages = useCallback(() => setMessages([]), []);
  const updateContext = useCallback((newContext: Partial<AITutorContext>) => {
    setContext(prev => ({ ...prev, ...newContext }));
  }, []);

  return { messages, isLoading, sendMessage, clearMessages, mode, role: currentRole, setRole: setCurrentRole, updateContext };
}
