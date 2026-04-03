import { cn } from '@/lib/utils';
import { Check, Circle, Lock } from 'lucide-react';
import { STEP_ORDER, STEP_LABELS } from '@/lib/step-config';

interface StepProgress {
  step: string;
  lessonId: string;
  completed: boolean;
}

interface StepProgressIndicatorProps {
  steps: StepProgress[];
  currentStep: string;
  onStepClick?: (lessonId: string) => void;
  className?: string;
}

export function StepProgressIndicator({
  steps,
  currentStep,
  onStepClick,
  className,
}: StepProgressIndicatorProps) {
  const currentStepIndex = STEP_ORDER.indexOf(currentStep as typeof STEP_ORDER[number]);
  
  const stepStatusMap = new Map<string, { lessonId: string; completed: boolean }>();
  steps.forEach(s => {
    stepStatusMap.set(s.step, { lessonId: s.lessonId, completed: s.completed });
  });

  return (
    <div className={cn("flex items-center justify-center gap-1 sm:gap-2", className)}>
      {STEP_ORDER.map((step, idx) => {
        const stepData = stepStatusMap.get(step);
        const isCurrent = step === currentStep;
        const isCompleted = stepData?.completed ?? false;
        const isLocked = idx > currentStepIndex && !isCompleted;
        const isClickable = !!stepData && !isLocked && !!onStepClick;
        
        return (
          <div key={step} className="flex items-center">
            <button
              onClick={() => isClickable && onStepClick?.(stepData!.lessonId)}
              disabled={!isClickable}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all",
                isCurrent && "bg-primary text-primary-foreground",
                isCompleted && !isCurrent && "bg-success/20 text-success",
                isLocked && "bg-muted text-muted-foreground opacity-50",
                !isCurrent && !isCompleted && !isLocked && "bg-muted/50 text-muted-foreground",
                isClickable && "cursor-pointer hover:opacity-80"
              )}
            >
              {isCompleted ? (
                <Check className="h-3 w-3" />
              ) : isLocked ? (
                <Lock className="h-3 w-3" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
              <span className="sm:hidden">{idx + 1}</span>
            </button>
            
            {idx < STEP_ORDER.length - 1 && (
              <div className={cn(
                "w-4 sm:w-8 h-0.5 mx-0.5",
                idx < currentStepIndex || isCompleted
                  ? "bg-success/40"
                  : "bg-muted"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
