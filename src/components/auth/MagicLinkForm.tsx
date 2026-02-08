import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Wand2, ArrowLeft, CheckCircle } from 'lucide-react';
import { z } from 'zod';

const emailSchema = z.string().email('Bitte geben Sie eine gültige E-Mail-Adresse ein');

interface MagicLinkFormProps {
  onBack: () => void;
}

export default function MagicLinkForm({ onBack }: MagicLinkFormProps) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string>();
  
  const { signInWithMagicLink } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setError(emailResult.error.errors[0].message);
      return;
    }
    
    setIsSubmitting(true);
    setError(undefined);

    try {
      const { error: magicLinkError } = await signInWithMagicLink(email);
      
      if (magicLinkError) {
        toast({
          title: 'Fehler',
          description: magicLinkError.message,
          variant: 'destructive',
        });
      } else {
        setIsSuccess(true);
        toast({
          title: 'Magic Link gesendet!',
          description: 'Prüfen Sie Ihren Posteingang.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="text-center py-4">
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-2xl bg-accent/20">
            <CheckCircle className="h-10 w-10 text-accent" />
          </div>
        </div>
        <h3 className="text-xl font-display font-bold text-foreground mb-2">
          Magic Link gesendet!
        </h3>
        <p className="text-muted-foreground mb-6">
          Wir haben Ihnen einen Anmelde-Link an <strong>{email}</strong> gesendet.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Klicken Sie auf den Link in der E-Mail, um sich anzumelden. Falls Sie keine E-Mail erhalten, überprüfen Sie bitte Ihren Spam-Ordner.
        </p>
        <Button
          variant="outline"
          onClick={onBack}
          className="rounded-xl"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück zur Anmeldung
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-2xl gradient-primary shadow-glow">
            <Wand2 className="h-10 w-10 text-primary-foreground" />
          </div>
        </div>
        <h2 className="text-3xl font-display font-bold text-foreground mb-2">
          Magic Link Login
        </h2>
        <p className="text-muted-foreground">
          Melden Sie sich ohne Passwort an. Wir senden Ihnen einen sicheren Link per E-Mail.
        </p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-foreground">E-Mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="ihre@email.de"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(undefined);
            }}
            disabled={isSubmitting}
            className={`h-12 bg-muted/50 border-border/50 focus:border-primary/50 rounded-xl text-foreground placeholder:text-muted-foreground ${error ? 'border-destructive' : ''}`}
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <Button 
          type="submit" 
          className="w-full h-12 gradient-primary text-primary-foreground shadow-glow hover:shadow-glow hover:opacity-90 transition-all rounded-xl text-base font-medium"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Bitte warten...
            </>
          ) : (
            <>
              <Wand2 className="h-5 w-5 mr-2" />
              Magic Link senden
            </>
          )}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center"
          disabled={isSubmitting}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Zurück zur Anmeldung
        </button>
      </div>
    </div>
  );
}
