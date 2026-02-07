import { Badge } from '@/components/ui/badge';
import { 
  Lightbulb, 
  BookOpen, 
  PenTool, 
  RotateCcw, 
  ClipboardCheck 
} from 'lucide-react';

const stepConfig: Record<string, { 
  label: string; 
  description: string;
  icon: React.ElementType; 
  color: string;
  bgColor: string;
}> = {
  einstieg: { 
    label: 'Einstieg', 
    description: 'Aktivierung des Vorwissens',
    icon: Lightbulb, 
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20'
  },
  verstehen: { 
    label: 'Verstehen', 
    description: 'Neues Wissen aufnehmen',
    icon: BookOpen, 
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20'
  },
  anwenden: { 
    label: 'Anwenden', 
    description: 'Wissen praktisch nutzen',
    icon: PenTool, 
    color: 'text-green-400',
    bgColor: 'bg-green-500/20'
  },
  wiederholen: { 
    label: 'Wiederholen', 
    description: 'Gelerntes festigen',
    icon: RotateCcw, 
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20'
  },
  mini_check: { 
    label: 'Mini-Check', 
    description: 'Wissen überprüfen',
    icon: ClipboardCheck, 
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/20'
  },
};

interface StepIndicatorProps {
  currentStep: string;
  lessonTitle: string;
}

export default function StepIndicator({ currentStep, lessonTitle }: StepIndicatorProps) {
  const stepInfo = stepConfig[currentStep] || stepConfig.einstieg;
  const StepIcon = stepInfo.icon;

  return (
    <>
      {/* 5-Step Progress Indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {Object.entries(stepConfig).map(([key, config], idx) => {
          const Icon = config.icon;
          const isActive = key === currentStep;
          const isPast = Object.keys(stepConfig).indexOf(currentStep) > idx;

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
              {idx < Object.keys(stepConfig).length - 1 && (
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

export { stepConfig };
