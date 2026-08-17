import { useState, useRef, useEffect } from 'react';
import {
  Settings, Plus, Cpu, UserPlus, Users, Lock,
} from 'lucide-react';
import { useGlobal } from 'reactn';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import Config from '../../../config';
import AddPeople from './AddPeople';

function TopBar() {
  const setPanel = useGlobal('panel')[1];
  const setOver = useGlobal('over')[1];
  const [user] = useGlobal('user');
  const [nav, setNav] = useGlobal('nav');
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const menuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = user?.level === 'root' || user?.level === 'admin';
  const initials = `${(user?.firstName || 'A').charAt(0)}${(user?.lastName || 'U').charAt(0)}`.toUpperCase();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleCreateGroup = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsMenuOpen(false);
    setOver(true);
    setPanel('createGroup');
  };

  const handleAddPerson = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsMenuOpen(false);
    setShowAddPeople(true);
  };

  return (
    <div className="flex h-16 w-full items-center justify-between px-4 bg-transparent border-b border-border/50">
      {/* Left: User Avatar */}
      <div className="flex items-center">
        <Avatar className="h-9 w-9 border border-border bg-muted text-foreground">
          {user?.picture && (
            <img
              src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
              alt=""
              className="aspect-square size-full object-cover"
            />
          )}
          <AvatarFallback className="bg-muted text-xs font-bold text-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Right Action Icons: Admin, New (+), Settings */}
      <div className="flex items-center gap-1 text-muted-foreground">
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 rounded-full hover:bg-muted hover:text-foreground ${
              location.pathname.startsWith('/admin') ? 'text-primary' : ''
            }`}
            onClick={() => {
              setOver(true);
              navigate('/admin', { replace: true });
            }}
            title="Admin Console"
          >
            <Cpu className="h-4 w-4" />
          </Button>
        )}

        {/* Plus: Add Person or Create Group (Reliable Direct Dropdown) */}
        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 rounded-full transition-colors ${
              isMenuOpen ? 'bg-muted text-foreground' : 'hover:bg-muted hover:text-foreground'
            }`}
            title="Create or Add"
            aria-label="Add person or create group"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <Plus className={`h-4 w-4 transition-transform duration-200 ${isMenuOpen ? 'rotate-45 text-primary' : ''}`} />
          </Button>

          {isMenuOpen && (
            <div className="absolute right-0 top-10 z-50 w-48 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-1 animate-in fade-in-0 zoom-in-95">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus:bg-muted transition-colors text-left"
                onClick={handleAddPerson}
              >
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <span>Add Person</span>
              </button>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus:bg-muted transition-colors text-left"
                onClick={handleCreateGroup}
              >
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>Create Group</span>
              </button>
            </div>
          )}
        </div>

        {/* Private Vault */}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 rounded-full hover:bg-muted hover:text-foreground', nav === 'vault' && 'text-primary')}
          onClick={() => setNav('vault')}
          title="Private Vault"
          aria-label="Private Vault"
        >
          <Lock className="h-4 w-4" />
        </Button>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full hover:bg-muted hover:text-foreground"
          onClick={() => {
            setOver(true);
            navigate('/settings', { replace: true });
          }}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {showAddPeople && <AddPeople onClose={() => setShowAddPeople(false)} />}
    </div>
  );
}

export default TopBar;
