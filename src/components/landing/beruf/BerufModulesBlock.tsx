/**
 * BerufModulesBlock — data-driven
 * ────────────────────────────────
 * Statt einer hardcodierten 6-Modul-Marketingliste wird hier der reale
 * Paket-Inhalt aus der DB gerendert (Feature-Flags + Live-Counts) –
 * verpackt im "Module für die {beruf}-Prüfung"-Layout.
 *
 * Wenn `curriculumId`/`courseId` fehlen, fällt der Block still aus
 * (z.B. SSOT-Fallback-Render in BerufDetailPage).
 */
import { CoursePackageContents } from '@/components/course/CoursePackageContents';

interface Props {
  beruf: string;
  kammer: string;
  curriculumId?: string | null;
  courseId?: string | null;
}

export function BerufModulesBlock({ beruf, curriculumId, courseId }: Props) {
  if (!curriculumId || !courseId) return null;

  return (
    <section className="border-t border-border-subtle bg-surface-sunken">
      <div className="container max-w-6xl py-12 md:py-16">
        <CoursePackageContents
          curriculumId={curriculumId}
          courseId={courseId}
          eyebrow={`Module für die ${beruf}-Prüfung`}
          headingOverride="Diese Module sind in deinem Paket enthalten."
        />
      </div>
    </section>
  );
}
