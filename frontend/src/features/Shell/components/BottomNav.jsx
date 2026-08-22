import {
  MessageCircle, Star, Video, Bell, Settings,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const ITEMS = [
  {
    to: '/', label: 'Chats', Icon: MessageCircle, end: true,
  },
  { to: '/favorites', label: 'Favorites', Icon: Star },
  { to: '/meetings', label: 'Meetings', Icon: Video },
  { to: '/notifications', label: 'Alerts', Icon: Bell },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

function BottomNav() {
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];
  const unreadTotal = roomsWithNewMessages.length;

  return (
    <nav className="flex h-14 w-full shrink-0 items-center justify-around border-t border-border bg-card px-1 text-card-foreground">
      {ITEMS.map(({
        to, label, Icon, end,
      }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cn(
            'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-muted-foreground transition-colors hover:text-foreground',
            isActive && 'text-primary font-semibold',
          )}
        >
          <span className="relative flex items-center justify-center">
            <Icon className="h-4.5 w-4.5" />
            {to === '/' && unreadTotal > 0 && (
              <Badge className="absolute -right-2 -top-1.5 h-4 min-w-4 justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </Badge>
            )}
            {label === 'Alerts' && unreadTotal > 0 && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
            )}
          </span>
          <span className="text-[10px] tracking-tight">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default BottomNav;
