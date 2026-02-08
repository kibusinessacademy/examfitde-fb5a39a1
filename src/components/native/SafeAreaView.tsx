import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SafeAreaViewProps {
  children: ReactNode;
  className?: string;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function SafeAreaView({ 
  children, 
  className,
  edges = ['top', 'bottom'] 
}: SafeAreaViewProps) {
  const safeAreaClasses = edges.map(edge => {
    switch (edge) {
      case 'top': return 'safe-top';
      case 'bottom': return 'safe-bottom';
      case 'left': return 'safe-left';
      case 'right': return 'safe-right';
      default: return '';
    }
  }).join(' ');

  return (
    <div className={cn('min-h-screen', safeAreaClasses, className)}>
      {children}
    </div>
  );
}
