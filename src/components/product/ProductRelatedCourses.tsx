import type { RelatedCourseItem } from '@/types/product-page';
import { CoursePremiumCard } from '@/components/shop/CoursePremiumCard';

interface Props {
  courses: RelatedCourseItem[];
  onCourseClick?: (slug: string) => void;
}

export function ProductRelatedCourses({ courses, onCourseClick }: Props) {
  if (courses.length === 0) return null;

  return (
    <section className="py-12 md:py-16 bg-muted/30 rounded-3xl mx-2 sm:mx-0">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-display font-bold">Weitere Prüfungstrainings</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {courses.map((course) => (
            <div key={course.slug} onClick={() => onCourseClick?.(course.slug)}>
              <CoursePremiumCard
                title={course.title}
                href={`/pruefungstraining/${course.slug}`}
                chamber={course.kammer ?? null}
                meta={course.domainLabel ?? course.teaser ?? null}
                primaryLabel="Zum Training"
                primaryIcon="arrow"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
