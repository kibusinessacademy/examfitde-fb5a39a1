import { AITutorChat } from '@/components/tutor/AITutorChat';
import { AI_MODES } from '@/hooks/useAITutor';

export default function TutorTest() {
  return (
    <div className="h-screen p-4">
      <AITutorChat 
        mode={AI_MODES.LEARNING}
        title="BWL Tutor Test"
        className="h-full"
      />
    </div>
  );
}
