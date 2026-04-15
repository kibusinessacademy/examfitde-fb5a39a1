import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Send, X, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CourseInquiryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCourses: { id: string; title: string }[];
  onRemoveCourse: (id: string) => void;
}

export function CourseInquiryDialog({ open, onOpenChange, selectedCourses, onRemoveCourse }: CourseInquiryDialogProps) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && email.includes('@') && selectedCourses.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const inquiryId = crypto.randomUUID();
      const { error } = await (supabase as any)
        .from('course_inquiries')
        .insert({
          id: inquiryId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          message: message.trim() || null,
          requested_courses: selectedCourses.map(c => ({ id: c.id, title: c.title })),
        });

      if (error) throw error;

      // Send notification email to info@examfit.de via mailto fallback
      const courseList = selectedCourses.map(c => c.title).join(', ');
      const mailBody = encodeURIComponent(
        `Neue Kursanfrage von ${firstName} ${lastName} (${email}):\n\nAngefragte Kurse: ${courseList}\n\nNachricht: ${message || '–'}\nTelefon: ${phone || '–'}`
      );
      const mailSubject = encodeURIComponent(`Kursanfrage: ${courseList.substring(0, 80)}`);
      
      // Open mailto link silently
      const mailLink = document.createElement('a');
      mailLink.href = `mailto:info@examfit.de?subject=${mailSubject}&body=${mailBody}`;
      mailLink.click();

      setSubmitted(true);
      toast({ title: 'Anfrage gesendet!', description: 'Wir melden uns schnellstmöglich bei dir.' });
    } catch (err) {
      toast({ title: 'Fehler', description: 'Anfrage konnte nicht gesendet werden.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    if (submitted) {
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setMessage('');
      setSubmitted(false);
    }
  };

  if (submitted) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <div className="text-center py-8">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">Anfrage erfolgreich gesendet!</h3>
            <p className="text-muted-foreground mb-6">
              Vielen Dank für dein Interesse. Wir prüfen deine Anfrage und melden uns schnellstmöglich per E-Mail.
            </p>
            <Button onClick={handleClose}>Schließen</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Kurs anfragen</DialogTitle>
          <DialogDescription>
            Hinterlasse deine Kontaktdaten und wir informieren dich, sobald der Kurs verfügbar ist.
          </DialogDescription>
        </DialogHeader>

        {/* Selected courses */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Angefragte Kurse</Label>
          <div className="flex flex-wrap gap-2">
            {selectedCourses.map(course => (
              <Badge key={course.id} variant="secondary" className="gap-1 pr-1">
                {course.title}
                <button onClick={() => onRemoveCourse(course.id)} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          {selectedCourses.length === 0 && (
            <p className="text-sm text-muted-foreground">Kein Kurs ausgewählt. Schließe das Fenster und klicke auf "Kurs anfragen".</p>
          )}
        </div>

        {/* Form */}
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Vorname *</Label>
              <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Max" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Nachname *</Label>
              <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Mustermann" required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">E-Mail-Adresse *</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="max@beispiel.de" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefon (optional)</Label>
            <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+49 123 456789" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message">Nachricht (optional)</Label>
            <Textarea
              id="message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Z.B. Prüfungstermin, besonderer Bedarf..."
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={handleClose}>Abbrechen</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="gradient-primary text-primary-foreground">
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Anfrage senden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
