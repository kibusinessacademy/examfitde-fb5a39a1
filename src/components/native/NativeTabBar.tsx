import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useNativeApp } from '@/hooks/useNativeApp';
import { Link, useLocation } from 'react-router-dom';
import { 
  Home, 
  BookOpen, 
  GraduationCap, 
  User,
  ShoppingBag
} from 'lucide-react';

interface TabItem {
  icon: ReactNode;
  label: string;
  href: string;
}

const defaultTabs: TabItem[] = [
  { icon: <Home className="h-5 w-5" />, label: 'Start', href: '/' },
  { icon: <BookOpen className="h-5 w-5" />, label: 'Kurse', href: '/courses' },
  { icon: <GraduationCap className="h-5 w-5" />, label: 'Trainer', href: '/exam-trainer' },
  { icon: <ShoppingBag className="h-5 w-5" />, label: 'Shop', href: '/shop' },
  { icon: <User className="h-5 w-5" />, label: 'Profil', href: '/dashboard' },
];

interface NativeTabBarProps {
  tabs?: TabItem[];
  className?: string;
}

export function NativeTabBar({ 
  tabs = defaultTabs,
  className 
}: NativeTabBarProps) {
  const { isNative, isIOS } = useNativeApp();
  const location = useLocation();

  // Never show on admin routes or non-native
  if (!isNative || location.pathname.startsWith('/admin')) return null;

  return (
    <nav 
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50',
        'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        'border-t border-border',
        'safe-bottom',
        isIOS && 'ios-footer',
        className
      )}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.href || 
            (tab.href !== '/' && location.pathname.startsWith(tab.href));
          
          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 py-2 px-1',
                'transition-colors touch-manipulation',
                isActive 
                  ? 'text-primary' 
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className={cn(
                'transition-transform',
                isActive && 'scale-110'
              )}>
                {tab.icon}
              </span>
              <span className={cn(
                'text-[10px] mt-1 font-medium',
                isActive && 'text-primary'
              )}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
