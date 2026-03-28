import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Bot, X } from 'lucide-react';
import { AITutorChat } from './AITutorChat';
import { AI_MODES, type AIMode } from '@/hooks/useAITutor';
import { cn } from '@/lib/utils';

interface TutorPanelProps {
  mode?: AIMode;
  sessionId?: string;
  sessionType?: 'learning' | 'practice' | 'exam' | 'lesson';
  className?: string;
  masteryUserId?: string;
  masteryCurriculumId?: string;
}

/**
 * Floating tutor panel that can be toggled open/closed
 * Used in lesson player, practice mode, etc.
 */
export function TutorPanel({ 
  mode = AI_MODES.LEARNING, 
  sessionId,
  sessionType,
  className,
  masteryUserId,
  masteryCurriculumId,
}: TutorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className={cn(
            "fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50",
            "bg-primary hover:bg-primary/90",
            className
          )}
        >
          <Bot className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent 
        side="right" 
        className="w-full sm:w-[400px] p-0 flex flex-col"
      >
        <div className="absolute top-4 right-4 z-10">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <AITutorChat 
          mode={mode}
          sessionId={sessionId}
          sessionType={sessionType}
          masteryUserId={masteryUserId}
          masteryCurriculumId={masteryCurriculumId}
          className="border-0 rounded-none h-full"
        />
      </SheetContent>
    </Sheet>
  );
}
