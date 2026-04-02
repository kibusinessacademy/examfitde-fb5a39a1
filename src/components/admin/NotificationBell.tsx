import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
  AdminSheetTrigger as SheetTrigger,
} from '@/components/admin/AdminSheet';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { useRealtimeInvalidation } from '@/hooks/useAdminRealtimeInvalidation';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  category: string;
  severity: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  // Gold-Pattern: Realtime invalidation instead of polling
  useRealtimeInvalidation('admin_notifications', [['admin-notifications']], 'bell');

  const { data: notifications = [] } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as Notification[];
    },
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('admin_notifications').update({ read_at: new Date().toISOString(), is_read: true } as any).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
      if (unreadIds.length === 0) return;
      await supabase.from('admin_notifications').update({ read_at: new Date().toISOString(), is_read: true } as any).in('id', unreadIds);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });

  const entityLink = (n: Notification) => {
    if (n.entity_type === 'course_package' && n.entity_id) {
      return `/admin/quality/review`;
    }
    return null;
  };

  return (
    <Sheet modal={false} open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[380px] sm:w-[420px]">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle>Benachrichtigungen</SheetTitle>
            {unreadCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => markAllRead.mutate()} className="text-xs">
                Alle gelesen
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-120px)]">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Keine Benachrichtigungen.</p>
          ) : (
            notifications.map(n => {
              const link = entityLink(n);
              return (
                <div
                  key={n.id}
                  className={cn(
                    "p-3 rounded-lg border border-border text-sm cursor-pointer transition-colors hover:bg-muted/50",
                    !n.is_read && "bg-primary/5 border-primary/20"
                  )}
                  onClick={() => {
                    if (!n.is_read) markRead.mutate(n.id);
                    if (link) {
                      setOpen(false);
                      window.location.href = link;
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium leading-tight">{n.title}</span>
                    {!n.is_read && <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />}
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-1">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {new Date(n.created_at).toLocaleString('de-DE')}
                    {n.category && <Badge variant="outline" className="ml-2 text-[9px] py-0">{n.category}</Badge>}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
