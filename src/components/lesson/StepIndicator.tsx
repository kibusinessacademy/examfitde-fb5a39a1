import { Badge } from '@/components/ui/badge';
import { STEP_ORDER, STEP_CONFIG } from '@/lib/step-config';

interface StepIndicatorProps {
  currentStep: string;
  lessonTitle: string;
}

export default function StepIndicator({ currentStep, lessonTitle }: StepIndicatorProps) {
  const stepInfo = STEP_CONFIG[currentStep] || STEP_CONFIG.einstieg;
  const StepIcon = stepInfo.icon;

  return (
    <>
      {/* Step Progress Indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEP_ORDER.map((key, idx) => {
          const config = STEP_CONFIG[key];
          const Icon = config.icon;
          const isActive = key === currentStep;
          const isPast = STEP_ORDER.indexOf(currentStep as typeof STEP_ORDER[number]) > idx;

          return (
            <div key={key} className="flex items-center">
              <div 
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center transition-all
                  ${isActive ? `${config.bgColor} ring-2 ring-offset-2 ring-offset-background ring-primary` : 
                    isPast ? 'bg-primary/20' : 'bg-muted'}
                `}
              >
                <Icon className={`h-5 w-5 ${isActive ? config.color : isPast ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              {idx < STEP_ORDER.length - 1 && (
                <div className={`w-8 h-0.5 ${isPast ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Header */}
      <div className="text-center mb-8">
        <Badge className={`${stepInfo.bgColor} ${stepInfo.color} border-0 mb-3`}>
          <StepIcon className="h-4 w-4 mr-1" />
          {stepInfo.label}
        </Badge>
        <h1 className="text-2xl md:text-3xl font-display font-bold">{lessonTitle}</h1>
        <p className="text-muted-foreground mt-2">{stepInfo.description}</p>
      </div>
    </>
  );
}

/** @deprecated Import STEP_CONFIG from '@/lib/step-config' instead */
export { STEP_CONFIG as stepConfig } from '@/lib/step-config';
