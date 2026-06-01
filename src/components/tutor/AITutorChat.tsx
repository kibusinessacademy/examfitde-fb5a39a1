import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Send, Loader2, Bot, User, Trash2,
  BookOpen, Target, Clock, AlertTriangle, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAITutor, AI_MODES, type AIMode, type ChatMessage } from '@/hooks/useAITutor';
import { motion, AnimatePresence } from 'framer-motion';
import { StructuredTutorAnswer } from './StructuredTutorAnswer';

interface AITutorChatProps {
  mode: AIMode;
  sessionId?: string;
  sessionType?: 'learning' | 'practice' | 'exam' | 'lesson';
  className?: string;
  title?: string;
  masteryUserId?: string;
  masteryCurriculumId?: string;
}

const MODE_CONFIG = {
  [AI_MODES.LEARNING]: {
    icon: BookOpen,
    label: 'Lernmodus',
    description: 'Volle Tutor-Unterstützung',
    color: 'bg-success-bg-subtle text-success border-success/20',
    gradient: 'from-success-bg-subtle to-transparent',
  },
  [AI_MODES.PRACTICE]: {
    icon: Target,
    label: 'Übungsmodus',
    description: 'Feedback nach Antwort',
    color: 'bg-warning-bg-subtle text-warning border-warning/20',
    gradient: 'from-warning-bg-subtle to-transparent',
  },
  [AI_MODES.EXAM]: {
    icon: Clock,
    label: 'Prüfungsmodus',
    description: 'Nur technische Hilfe',
    color: 'bg-danger-bg-subtle text-danger border-danger/20',
    gradient: 'from-danger-bg-subtle to-transparent',
  },
};

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2 px-4 py-3 premium-reveal">
      <div className="w-7 h-7 rounded-full bg-petrol-100 flex items-center justify-center flex-shrink-0">
        <Bot className="h-4 w-4 text-petrol-600" />
      </div>
      <div className="flex-1 max-w-md space-y-2">
        <div className="flex gap-1 items-center px-3 py-2 rounded-xl bg-surface-sunken w-fit">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-text-tertiary"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
        {/* Anticipatory skeleton — signals "answer is forming" */}
        <div className="space-y-1.5" aria-hidden="true">
          <div className="h-2.5 rounded-md premium-shimmer w-11/12" />
          <div className="h-2.5 rounded-md premium-shimmer w-4/5" />
          <div className="h-2.5 rounded-md premium-shimmer w-2/3" />
        </div>
        <span className="sr-only">Tutor formuliert eine Antwort…</span>
      </div>
    </div>
  );
}

export function AITutorChat({ 
  mode, sessionId, sessionType, className,
  title = 'AI-Tutor', masteryUserId, masteryCurriculumId,
}: AITutorChatProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const { messages, isLoading, sendMessage, clearMessages, suggestedPrompts } = useAITutor({
    mode, sessionId, sessionType,
    context: { masteryUserId, masteryCurriculumId },
  });

  const modeConfig = MODE_CONFIG[mode];
  const ModeIcon = modeConfig.icon;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const message = input;
    setInput('');
    await sendMessage(message);
    inputRef.current?.focus();
  };

  return (
    <Card variant="raised" className={cn("flex flex-col h-full overflow-hidden", className)} data-density="comfortable">
      {/* Header */}
      <CardHeader className={cn("pb-3 flex-shrink-0 bg-gradient-to-r", modeConfig.gradient)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-petrol-100 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-petrol-600" />
            </div>
            <div>
              <CardTitle className="text-base font-display">{title}</CardTitle>
              <p className="text-xs text-text-secondary">{modeConfig.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", modeConfig.color)}>
              <ModeIcon className="h-3 w-3 mr-1" />
              {modeConfig.label}
            </Badge>
            {messages.length > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearMessages} title="Chat leeren">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        {/* Exam Mode Warning */}
        {mode === AI_MODES.EXAM && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="mx-4 mb-2 p-2.5 rounded-xl bg-danger-bg-subtle border border-danger/20 flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 text-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-danger">
              Im Prüfungsmodus ist keine inhaltliche Hilfe verfügbar. Der Tutor kann nur bei technischen Fragen helfen.
            </p>
          </motion.div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="space-y-3 py-4">
            {messages.length === 0 ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-10"
              >
                <div className="w-16 h-16 rounded-2xl bg-petrol-100 flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-8 w-8 text-petrol-600" />
                </div>
                <p className="text-sm font-medium mb-1 text-text-primary">
                  {mode === AI_MODES.EXAM ? 'Nur technische Fragen möglich' : 'Hallo! Wie kann ich dir helfen?'}
                </p>
                <p className="text-xs text-text-secondary">
                  {mode === AI_MODES.EXAM ? '' : 'Stelle eine Frage oder wähle einen Vorschlag unten.'}
                </p>
              </motion.div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((message, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.25 }}
                  >
                    <MessageBubble message={message} />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
            
            {isLoading && <TypingIndicator />}
          </div>
        </ScrollArea>

        {/* Suggested Prompts */}
        {messages.length === 0 && suggestedPrompts.length > 0 && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="px-4 pb-3 flex flex-wrap gap-1.5"
          >
            {suggestedPrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => { setInput(''); sendMessage(prompt); }}
                disabled={isLoading}
                className="text-xs px-3 py-2 rounded-xl border border-petrol-200 bg-petrol-50 hover:bg-petrol-100 text-text-primary hover:text-petrol-700 transition-colors duration-base disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </motion.div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-border-subtle bg-surface-raised/50 backdrop-blur-sm flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === AI_MODES.EXAM ? "Technische Frage stellen…" : "Frage stellen…"}
            disabled={isLoading}
            className="flex-1 rounded-xl border-border-subtle bg-surface-sunken focus:bg-surface-raised"
          />
          <Button type="submit" variant="petrol" size="icon" disabled={isLoading || !input.trim()} className="rounded-xl h-10 w-10">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
        isUser ? "bg-petrol-600" : "bg-petrol-100"
      )}>
        {isUser ? (
          <User className="h-3.5 w-3.5 text-petrol-50" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-petrol-600" />
        )}
      </div>
      <div className={cn(
        "rounded-2xl px-4 py-2.5 max-w-[80%]",
        isUser 
          ? "bg-petrol-600 text-petrol-50 rounded-br-md" 
          : message.wasBlocked
            ? "bg-danger-bg-subtle border border-danger/20 text-text-primary rounded-bl-md"
            : "bg-surface-sunken text-text-primary rounded-bl-md"
      )}>
        {isUser || message.wasBlocked ? (
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1.5 [&>p:last-child]:mb-0">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <StructuredTutorAnswer content={message.content} />
        )}
        <p className={cn(
          "text-[10px] mt-1.5 opacity-60 tabular-nums",
          isUser ? "text-right" : "text-left"
        )}>
          {message.timestamp.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
