import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// AI Tutor Governance Modes (SSOT - mirrors backend)
export const AI_MODES = {
  LEARNING: 'learning',
  PRACTICE: 'practice',
  EXAM: 'exam'
} as const;

// AI Tutor Didactic Roles (SSOT - mirrors backend)
export const AI_ROLES = {
  EXPLAINER: 'explainer',
  COACH: 'coach',
  EXAMINER: 'examiner',
  FEEDBACK: 'feedback'
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
  curriculumId?: string;
  curriculumTitle?: string;
  learningFieldId?: string;
  learningFieldTitle?: string;
  competencyId?: string;
  competencyTitle?: string;
  lessonId?: string;
  lessonTitle?: string;
  lessonStep?: string;
  miniCheckScore?: number;
}

interface UseAITutorOptions {
  mode: AIMode;
  role?: AIRole;
  sessionId?: string;
  sessionType?: 'learning' | 'practice' | 'exam' | 'lesson';
  context?: AITutorContext;
}

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
      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke('ai-tutor', {
        body: { message, mode, role: currentRole, sessionId, sessionType, conversationHistory, context },
      });

      if (error) throw error;
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
