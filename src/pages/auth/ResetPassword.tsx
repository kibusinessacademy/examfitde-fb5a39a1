import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { GraduationCap, Loader2, Lock, CheckCircle } from 'lucide-react';
import { z } from 'zod';

const passwordSchema = z.string().min(6, 'Das Passwort muss mindestens 6 Zeichen haben');

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  
  const { updatePassword, user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // User must be authenticated via the reset link to access this page
    if (!loading && !user) {
      toast({
        title: 'Ungültiger Link',
        description: 'Der Reset-Link ist abgelaufen oder ungültig. Bitte fordern Sie einen neuen an.',
        variant: 'destructive',
      });
      navigate('/auth');
    }
  }, [user, loading, navigate, toast]);

  const validateForm = () => {
    const newErrors: { password?: string; confirmPassword?: string } = {};
    
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      newErrors.password = passwordResult.error.errors[0].message;
    }
    
    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Die Passwörter stimmen nicht überein';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsSubmitting(true);

    try {
      const { error } = await updatePassword(password);
      
      if (error) {
        toast({
          title: 'Fehler',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        setIsSuccess(true);
        toast({
          title: 'Passwort geändert!',
          description: 'Ihr Passwort wurde erfolgreich aktualisiert.',
        });
        
        setTimeout(() => {
          navigate('/');
        }, 2000);
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

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
        <div className="orb orb-primary w-96 h-96 -top-48 -left-48 fixed" />
        <div className="orb orb-accent w-80 h-80 bottom-20 right-20 fixed" />
        
        <div className="glass-strong rounded-3xl w-full max-w-md p-8 text-center animate-fade-in">
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-2xl bg-accent/20">
              <CheckCircle className="h-12 w-12 text-accent" />
            </div>
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">
            Passwort geändert!
          </h2>
          <p className="text-muted-foreground">
            Sie werden weitergeleitet...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="orb orb-primary w-96 h-96 -top-48 -left-48 fixed" />
      <div className="orb orb-accent w-80 h-80 bottom-20 right-20 fixed" />
      
      <div className="glass-strong rounded-3xl w-full max-w-md animate-fade-in">
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <div className="p-4 rounded-2xl gradient-primary shadow-glow">
                <Lock className="h-10 w-10 text-primary-foreground" />
              </div>
            </div>
            <h2 className="text-3xl font-display font-bold text-foreground mb-2">
              Neues Passwort setzen
            </h2>
            <p className="text-muted-foreground">
              Geben Sie Ihr neues Passwort ein.
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground">Neues Passwort</Label>
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

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-foreground">Passwort bestätigen</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: undefined }));
                }}
                disabled={isSubmitting}
                className={`h-12 bg-muted/50 border-border/50 focus:border-primary/50 rounded-xl text-foreground placeholder:text-muted-foreground ${errors.confirmPassword ? 'border-destructive' : ''}`}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword}</p>
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
                'Passwort ändern'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
