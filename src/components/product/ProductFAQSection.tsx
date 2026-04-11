import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { FAQItem } from '@/types/product-page';

interface Props {
  items: FAQItem[];
  onExpand?: (question: string) => void;
}

export function ProductFAQSection({ items, onExpand }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="py-12 md:py-16">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">FAQ</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">Häufige Fragen</h2>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {items.map((faq, i) => (
            <AccordionItem key={i} value={`faq-${i}`}>
              <AccordionTrigger
                className="text-left text-base"
                onClick={() => onExpand?.(faq.question)}
              >
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
