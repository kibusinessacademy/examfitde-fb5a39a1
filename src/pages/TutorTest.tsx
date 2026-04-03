import { AITutorChat } from '@/components/tutor/AITutorChat';
import { AI_MODES } from '@/hooks/useAITutor';

export default function TutorTest() {
  return (
    <div className="h-screen p-4">
      <AITutorChat 
        mode={AI_MODES.LEARNING}
        title="BWL Studium Tutor Test"
        className="h-full"
        masteryCurriculumId="a0b0c0d0-0002-4000-8000-000000000001"
      />
    </div>
  );
}
