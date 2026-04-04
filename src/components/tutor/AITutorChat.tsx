import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Send, 
  Loader2, 
  Bot, 
  User, 
  Trash2,
  BookOpen,
  Target,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAITutor, AI_MODES, type AIMode, type ChatMessage } from '@/hooks/useAITutor';

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
  },
  [AI_MODES.PRACTICE]: {
    icon: Target,
    label: 'Übungsmodus',
    description: 'Feedback nach Antwort',
    color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  },
  [AI_MODES.EXAM]: {
    icon: Clock,
    label: 'Prüfungsmodus',
    description: 'Nur technische Hilfe',
    color: 'bg-red-500/10 text-red-600 border-red-500/30',
  },
};

export function AITutorChat({ 
  mode, 
  sessionId, 
  sessionType,
  className,
  title = 'AI-Tutor',
  masteryUserId,
  masteryCurriculumId,
}: AITutorChatProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const { messages, isLoading, sendMessage, clearMessages, suggestedPrompts } = useAITutor({
    mode,
    sessionId,
    sessionType,
    context: {
      masteryUserId,
      masteryCurriculumId,
    },
  });

  const modeConfig = MODE_CONFIG[mode];
  const ModeIcon = modeConfig.icon;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    const message = input;
    setInput('');
    await sendMessage(message);
    inputRef.current?.focus();
  };

  return (
    <Card className={cn("glass-card flex flex-col h-full", className)}>
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", modeConfig.color)}>
              <ModeIcon className="h-3 w-3 mr-1" />
              {modeConfig.label}
            </Badge>
            {messages.length > 0 && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={clearMessages}
                title="Chat leeren"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{modeConfig.description}</p>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        {/* Exam Mode Warning */}
        {mode === AI_MODES.EXAM && (
          <div className="mx-4 mb-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">
              Im Prüfungsmodus ist keine inhaltliche Hilfe verfügbar. 
              Der Tutor kann nur bei technischen Fragen helfen.
            </p>
          </div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Bot className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">
                  {mode === AI_MODES.EXAM 
                    ? 'Nur technische Fragen möglich'
                    : 'Stelle mir eine Frage...'
                  }
                </p>
              </div>
            ) : (
              messages.map((message, idx) => (
                <MessageBubble key={idx} message={message} />
              ))
            )}
            
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Denke nach...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === AI_MODES.EXAM 
                ? "Technische Frage stellen..." 
                : "Frage stellen..."
            }
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={cn(
      "flex gap-2",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
        isUser ? "bg-primary" : "bg-muted"
      )}>
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className={cn(
        "rounded-lg px-3 py-2 max-w-[80%]",
        isUser 
          ? "bg-primary text-primary-foreground" 
          : message.wasBlocked
            ? "bg-destructive/10 border border-destructive/30 text-foreground"
            : "bg-muted text-foreground"
      )}>
        <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        <p className={cn(
          "text-[10px] mt-1 opacity-70",
          isUser ? "text-right" : "text-left"
        )}>
          {message.timestamp.toLocaleTimeString('de-DE', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </p>
      </div>
    </div>
  );
}
