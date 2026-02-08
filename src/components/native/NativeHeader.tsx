import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useNativeApp } from '@/hooks/useNativeApp';

interface NativeHeaderProps {
  children: ReactNode;
  className?: string;
  transparent?: boolean;
}

export function NativeHeader({ 
  children, 
  className,
  transparent = false 
}: NativeHeaderProps) {
  const { isIOS, isAndroid, isNative } = useNativeApp();

  return (
    <header 
      className={cn(
        'sticky top-0 z-50 w-full',
        !transparent && 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        'border-b border-border',
        isNative && 'safe-top',
        isIOS && 'ios-header',
        isAndroid && 'android-header',
        className
      )}
    >
      <div className="container flex h-14 items-center">
        {children}
      </div>
    </header>
  );
}
