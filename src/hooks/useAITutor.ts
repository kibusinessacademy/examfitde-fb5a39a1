import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// AI Tutor Governance Modes (SSOT - mirrors backend)
export const AI_MODES = {
  LEARNING: 'learning',
  PRACTICE: 'practice',
  EXAM: 'exam'
} as const;

export type AIMode = typeof AI_MODES[keyof typeof AI_MODES];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  wasBlocked?: boolean;
}

interface UseAITutorOptions {
  mode: AIMode;
  sessionId?: string;
  sessionType?: 'learning' | 'practice' | 'exam' | 'lesson';
}

interface UseAITutorReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (message: string) => Promise<void>;
  clearMessages: () => void;
  mode: AIMode;
}

export function useAITutor({ 
  mode, 
  sessionId, 
  sessionType = 'learning' 
}: UseAITutorOptions): UseAITutorReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;

    // Add user message immediately
    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Build conversation history for context
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke('ai-tutor', {
        body: {
          message,
          mode,
          sessionId,
          sessionType,
          conversationHistory,
        },
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        // Handle specific error cases
        if (data.error.includes('Rate limit')) {
          toast({
            title: 'Zu viele Anfragen',
            description: 'Bitte warte einen Moment und versuche es erneut.',
            variant: 'destructive',
          });
        } else if (data.error.includes('Kontingent')) {
          toast({
            title: 'AI-Kontingent erschöpft',
            description: 'Das AI-Budget ist aufgebraucht.',
            variant: 'destructive',
          });
        }
        throw new Error(data.error);
      }

      // Add assistant response
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        wasBlocked: data.wasBlocked,
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Show info if request was blocked in exam mode
      if (data.wasBlocked) {
        toast({
          title: 'Hinweis',
          description: 'Im Prüfungsmodus ist keine inhaltliche Hilfe verfügbar.',
        });
      }

    } catch (error) {
      console.error('AI Tutor error:', error);
      
      // Add error message to chat
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Entschuldigung, es gab einen Fehler. Bitte versuche es erneut.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);

      toast({
        title: 'Fehler',
        description: 'Der AI-Tutor konnte nicht antworten.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [messages, mode, sessionId, sessionType, toast]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    mode,
  };
}
