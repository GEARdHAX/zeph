import { useState } from 'react';
import {
  MessageCircle, Star, Video, Bell, Settings,
} from 'lucide-react';
import { useGlobal } from 'reactn';
import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import logo from '../../../assets/logo.png';
import Config from '../../../config';

const PRIMARY_ITEMS = [
  {
    to: '/', label: 'Chats', Icon: MessageCircle, end: true,
  },
  { to: '/favorites', label: 'Favorites', Icon: Star },
  { to: '/meetings', label: 'Meetings', Icon: Video },
];

const SECONDARY_ITEMS = [
  { to: '/notifications', label: 'Notifications', Icon: Bell },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

function NavRail() {
  const [isHovered, setIsHovered] = useState(false);
  const user = useGlobal('user')[0] || {};
  const onlineUsers = useSelector((state) => state.io.onlineUsers) || [];
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];

  const unreadTotal = roomsWithNewMessages.length;
  const isOnline = onlineUsers.some((u) => u.id === user.id && u.status === 'online');

  const initials = `${(user.firstName || 'U').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || 'AU';

  const itemClasses = ({ isActive }) => cn(
    'relative flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
    isActive && 'bg-primary/15 text-primary shadow-inner font-semibold hover:bg-primary/20 hover:text-primary dark:bg-primary/20',
  );

  return (
    <nav
      data-tour="nav-rail"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group flex h-full shrink-0 flex-col justify-between border-r border-border bg-card text-card-foreground transition-all duration-300 ease-in-out',
        isHovered ? 'w-[230px]' : 'w-[72px]',
      )}
    >
      {/* Top Section */}
      <div className="flex flex-col">
        {/* Brand Header */}
        <div className="flex h-16 items-center px-4 overflow-hidden">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center">
            <img src={logo} alt="Chitcx" className="h-7 w-7 object-contain" />
          </div>
          <span
            className={cn(
              'ml-3 whitespace-nowrap text-xl font-bold tracking-tight text-foreground transition-all duration-300 ease-in-out',
              isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none w-0 overflow-hidden',
            )}
          >
            {Config.brand || 'Chitcx'}
          </span>
        </div>

        {/* Navigation Links */}
        <div className="flex flex-col gap-1.5 px-2.5 py-2">
          {PRIMARY_ITEMS.map(({
            to, label, Icon, end,
          }) => (
            <NavLink key={to} to={to} end={end} className={itemClasses} title={!isHovered ? label : undefined}>
              <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <Icon className="h-[19px] w-[19px]" />
                {!isHovered && to === '/' && unreadTotal > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white ring-2 ring-card">
                    {unreadTotal > 99 ? '99+' : unreadTotal}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'whitespace-nowrap transition-all duration-300 ease-in-out',
                  isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none w-0 overflow-hidden',
                )}
              >
                {label}
              </span>
              {isHovered && to === '/' && unreadTotal > 0 && (
                <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </Badge>
              )}
            </NavLink>
          ))}

          <div className="my-2 border-t border-border" />

          {SECONDARY_ITEMS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className={itemClasses} title={!isHovered ? label : undefined}>
              <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <Icon className="h-[19px] w-[19px]" />
                {!isHovered && label === 'Notifications' && unreadTotal > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white ring-2 ring-card">
                    {unreadTotal > 99 ? '99+' : unreadTotal}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'whitespace-nowrap transition-all duration-300 ease-in-out',
                  isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none w-0 overflow-hidden',
                )}
              >
                {label}
              </span>
              {isHovered && label === 'Notifications' && unreadTotal > 0 && (
                <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
                  {unreadTotal}
                </Badge>
              )}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Bottom Profile Pill */}
      <div className="p-2.5 overflow-hidden">
        <NavLink
          to="/profile"
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-2xl border border-border bg-muted/30 p-2 transition-all duration-300 hover:bg-muted/70 hover:border-border/80',
            isActive && 'bg-muted border-primary/40',
          )}
          title={!isHovered ? `${user.firstName || 'Admin'} ${user.lastName || 'User'}` : undefined}
        >
          <div className="relative shrink-0">
            <Avatar className="h-9 w-9 border border-border bg-gradient-to-br from-primary/80 to-rose-700">
              {user.picture && (
                <img
                  src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
                  alt=""
                  className="aspect-square size-full object-cover"
                />
              )}
              <AvatarFallback className="bg-transparent text-xs font-bold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card',
                isOnline ? 'bg-emerald-500' : 'bg-emerald-500',
              )}
            />
          </div>
          <div
            className={cn(
              'min-w-0 flex-1 whitespace-nowrap transition-all duration-300 ease-in-out',
              isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none w-0 overflow-hidden',
            )}
          >
            <div className="truncate text-xs font-semibold text-foreground">
              {user.firstName || 'Admin'}
              {' '}
              {user.lastName || 'User'}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {user.email || 'admin@example.com'}
            </div>
          </div>
        </NavLink>
      </div>
    </nav>
  );
}

export default NavRail;
