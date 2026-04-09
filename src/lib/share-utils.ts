import type { ShareEvent } from '@/types/share';

const SITE_URL = 'https://examfitde.lovable.app';

export function buildShareText(event: ShareEvent): string {
  switch (event.event_type) {
    case 'exam_session_completed_high_score':
      return `🔥 Ich habe gerade ${Math.round(event.score_percent ?? 0)}% in einer ExamFit-Prüfungssimulation erreicht!`;
    case 'exam_session_improvement_milestone':
      return `🚀 Ich habe mich um ${Math.round(event.delta_percent ?? 0)} Prozentpunkte verbessert – ExamFit wirkt!`;
    case 'hard_question_correct':
      return `💪 Nur ${Math.round(100 - (event.rarity_percent ?? 0))}% lösen diese Frage richtig – ich schon!`;
    case 'competency_mastered':
      return `✅ Kompetenz gemeistert – ein Schritt näher zur Prüfung!`;
    case 'streak_milestone':
      return `📚 ${event.streak_days ?? 0} Tage in Folge gelernt – ich ziehe durch!`;
    default:
      return `Ich mache Fortschritte mit ExamFit.`;
  }
}

export function buildShareUrl(curriculumId?: string | null): string {
  return curriculumId ? `${SITE_URL}/shop?curriculum=${curriculumId}` : SITE_URL;
}

export function buildWhatsAppLink(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
}

export function buildLinkedInLink(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}
