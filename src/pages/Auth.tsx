import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { BookOpen, GraduationCap, Loader2 } from 'lucide-react';
import { z } from 'zod';

const emailSchema = z.string().email('Bitte geben Sie eine gültige E-Mail-Adresse ein');
const passwordSchema = z.string().min(6, 'Das Passwort muss mindestens 6 Zeichen haben');

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  
  const { signIn, signUp, user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      newErrors.email = emailResult.error.errors[0].message;
    }
    
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      newErrors.password = passwordResult.error.errors[0].message;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsSubmitting(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast({
              title: 'Anmeldung fehlgeschlagen',
              description: 'E-Mail oder Passwort ist falsch.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Fehler',
              description: error.message,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Willkommen zurück!',
            description: 'Sie wurden erfolgreich angemeldet.',
          });
        }
      } else {
        const { error } = await signUp(email, password, fullName);
        if (error) {
          if (error.message.includes('already registered')) {
            toast({
              title: 'Konto existiert bereits',
              description: 'Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an.',
              variant: 'destructive',
            });
            setIsLogin(true);
          } else {
            toast({
              title: 'Fehler',
              description: error.message,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Konto erstellt!',
            description: 'Willkommen auf der Lernplattform.',
          });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-primary w-96 h-96 -top-48 -left-48 fixed" />
      <div className="orb orb-accent w-80 h-80 bottom-20 right-20 fixed" />
      <div className="orb orb-rose w-64 h-64 top-1/3 left-1/3 fixed" />

      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12">
        <div className="absolute inset-0 gradient-hero opacity-80" />
        <div className="absolute inset-0 glass-subtle" />
        <div className="max-w-md text-center relative z-10">
          <div className="flex justify-center mb-8">
            <div className="p-5 rounded-3xl glass shadow-glow">
              <GraduationCap className="h-16 w-16 text-foreground" />
            </div>
          </div>
          <h1 className="text-4xl font-display font-bold mb-4 text-foreground">
            H5P Lernplattform
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            Interaktives Lernen mit modernen didaktischen Methoden
          </p>
          <div className="space-y-4 text-left">
            <div className="flex items-center gap-4 glass-card rounded-xl p-4">
              <BookOpen className="h-6 w-6 text-primary flex-shrink-0" />
              <span className="text-foreground">Lernkurse mit 5-Schritte-Didaktik</span>
            </div>
            <div className="flex items-center gap-4 glass-card rounded-xl p-4">
              <GraduationCap className="h-6 w-6 text-accent flex-shrink-0" />
              <span className="text-foreground">Prüfungstrainer mit KI-generierten Fragen</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Auth form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative z-10">
        <div className="glass-strong rounded-3xl w-full max-w-md animate-fade-in">
          <div className="p-8">
            <div className="text-center mb-8">
              <div className="flex justify-center mb-6 lg:hidden">
                <div className="p-4 rounded-2xl gradient-primary shadow-glow">
                  <GraduationCap className="h-10 w-10 text-primary-foreground" />
                </div>
              </div>
              <h2 className="text-3xl font-display font-bold text-foreground mb-2">
                {isLogin ? 'Anmelden' : 'Registrieren'}
              </h2>
              <p className="text-muted-foreground">
                {isLogin 
                  ? 'Willkommen zurück! Bitte melden Sie sich an.'
                  : 'Erstellen Sie ein Konto, um zu beginnen.'}
              </p>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-5">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="fullName" className="text-foreground">Vollständiger Name</Label>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="Max Mustermann"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={isSubmitting}
                    className="h-12 bg-muted/50 border-border/50 focus:border-primary/50 rounded-xl text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ihre@email.de"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                  }}
                  disabled={isSubmitting}
                  className={`h-12 bg-muted/50 border-border/50 focus:border-primary/50 rounded-xl text-foreground placeholder:text-muted-foreground ${errors.email ? 'border-destructive' : ''}`}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">Passwort</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                  }}
                  disabled={isSubmitting}
                  className={`h-12 bg-muted/50 border-border/50 focus:border-primary/50 rounded-xl text-foreground placeholder:text-muted-foreground ${errors.password ? 'border-destructive' : ''}`}
                />
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password}</p>
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
                  isLogin ? 'Anmelden' : 'Registrieren'
                )}
              </Button>
            </form>

            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setErrors({});
                }}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
                disabled={isSubmitting}
              >
                {isLogin 
                  ? 'Noch kein Konto? Jetzt registrieren' 
                  : 'Bereits ein Konto? Jetzt anmelden'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
