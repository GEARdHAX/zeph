import { Check, Plus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Config from '../../../config';

function User({ user, selected, onSelect }) {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
  const initials = `${(user.firstName || 'U').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || 'U';

  return (
    <div className="px-3 py-1">
      <button
        type="button"
        className={`group relative flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-all duration-200 ${
          selected
            ? 'bg-primary/10 border border-primary/30 text-foreground'
            : 'bg-transparent hover:bg-muted/60 text-foreground'
        }`}
        onClick={onSelect}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <Avatar className="h-9 w-9 border border-white/10 bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
            {user.picture && (
              <img
                src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
                alt={fullName}
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-xs font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* User Details */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
            {fullName}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{`@${user.username}`}</div>
        </div>

        {/* Selection Checkbox Pill */}
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all ${
            selected
              ? 'bg-primary text-white shadow-sm'
              : 'border border-border text-muted-foreground group-hover:border-primary/50'
          }`}
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </div>
      </button>
    </div>
  );
}

export default User;
