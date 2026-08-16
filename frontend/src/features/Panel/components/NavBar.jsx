import { useGlobal } from 'reactn';
import { MessageCircle, Star, Users, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { key: 'rooms', label: 'Rooms', Icon: MessageCircle },
  { key: 'search', label: 'Search', Icon: Search },
  { key: 'favorites', label: 'Favorites', Icon: Star },
  { key: 'meetings', label: 'Meetings', Icon: Users },
];

function NavBar() {
  const [nav, setNav] = useGlobal('nav');

  return (
    <div className="flex h-11 items-center border-b px-2">
      {ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={cn(
            'flex w-1/4 flex-col items-center justify-center gap-0.5 py-1 text-muted-foreground hover:text-foreground',
            nav === key && 'text-blue-700 hover:text-blue-700',
          )}
          onClick={() => setNav(key)}
        >
          <Icon className="h-[18px] w-[18px]" />
          <span className="text-[9px]">{label}</span>
        </button>
      ))}
    </div>
  );
}

export default NavBar;
