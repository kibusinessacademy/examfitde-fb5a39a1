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
    color: 'bg-green-500/10 text-green-600 border-green-500/30',
    gradient: 'from-green-500/5 to-transparent',
  },
  [AI_MODES.PRACTICE]: {
    icon: Target,
    label: 'Übungsmodus',
    description: 'Feedback nach Antwort',
    color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
    gradient: 'from-yellow-500/5 to-transparent',
  },
  [AI_MODES.EXAM]: {
    icon: Clock,
    label: 'Prüfungsmodus',
    description: 'Nur technische Hilfe',
    color: 'bg-red-500/10 text-red-600 border-red-500/30',
    gradient: 'from-red-500/5 to-transparent',
  },
};

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex gap-1 items-center px-3 py-2 rounded-xl bg-muted">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-muted-foreground/40"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
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
    <Card className={cn("glass-card flex flex-col h-full overflow-hidden", className)}>
      {/* Header */}
      <CardHeader className={cn("pb-3 flex-shrink-0 bg-gradient-to-r", modeConfig.gradient)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="text-xs text-muted-foreground">{modeConfig.description}</p>
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
            className="mx-4 mb-2 p-2.5 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">
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
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm font-medium mb-1">
                  {mode === AI_MODES.EXAM ? 'Nur technische Fragen möglich' : 'Hallo! Wie kann ich dir helfen?'}
                </p>
                <p className="text-xs text-muted-foreground">
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
                className="text-xs px-3 py-2 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 text-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </motion.div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t bg-background/50 backdrop-blur-sm flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === AI_MODES.EXAM ? "Technische Frage stellen…" : "Frage stellen…"}
            disabled={isLoading}
            className="flex-1 rounded-xl border-border/50 bg-muted/50 focus:bg-background"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()} className="rounded-xl h-10 w-10 gradient-primary text-primary-foreground">
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
        isUser ? "bg-primary" : "bg-primary/10"
      )}>
        {isUser ? (
          <User className="h-3.5 w-3.5 text-primary-foreground" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
      <div className={cn(
        "rounded-2xl px-4 py-2.5 max-w-[80%]",
        isUser 
          ? "bg-primary text-primary-foreground rounded-br-md" 
          : message.wasBlocked
            ? "bg-destructive/10 border border-destructive/30 text-foreground rounded-bl-md"
            : "bg-muted text-foreground rounded-bl-md"
      )}>
        <div className="text-sm prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1.5 [&>p:last-child]:mb-0">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        <p className={cn(
          "text-[10px] mt-1.5 opacity-60",
          isUser ? "text-right" : "text-left"
        )}>
          {message.timestamp.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
