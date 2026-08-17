import { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useGlobal } from 'reactn';
import { Lightbox } from 'react-modal-image';
import { Users, Image as ImageIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import Config from '../../../config';

const STATUS_COLOR = {
  online: 'bg-emerald-500',
  away: 'bg-orange-500',
  busy: 'bg-destructive',
  offline: 'bg-zinc-400',
};

function Room() {
  const room = useSelector((state) => state.io.room) || {};
  const onlineUsers = useSelector((state) => state.io.onlineUsers) || [];
  const imagesNumber = useSelector((state) => state.io.room?.images?.length || 0);
  const user = useGlobal('user')[0] || {};

  const scrollContainer = useRef(null);

  const [scrollHeight, setScrollHeight] = useState(0);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('members'); // 'members' | 'media'

  useEffect(() => {
    if (scrollContainer.current && scrollContainer.current.scrollTop === 0) {
      scrollContainer.current.scrollTop = scrollHeight;
    }
  }, [imagesNumber]);

  let other = {
    firstName: 'A',
    lastName: 'A',
  };

  if (!room.isGroup && room.people) {
    room.people.forEach((person) => {
      if (person._id !== user.id) other = person;
    });
  }

  const initials = (room.isGroup
    ? (room.title || 'G').charAt(0)
    : `${(other.firstName || 'U').charAt(0)}${(other.lastName || '').charAt(0)}`
  ).toUpperCase();

  const title = room.isGroup ? room.title : `${other.firstName} ${other.lastName}`;

  const rows = [];
  let row = [];

  const roomImages = room.images || [];

  roomImages.forEach((message) => {
    row.push(message);
    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length > 0) rows.push(row);

  const images = rows.map((imageRow, key) => {
    const rowImages = imageRow.map((message) => (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <img
        src={`${Config.url || ''}/api/images/${message.content}/256`}
        alt={`Sent by @${message.author?.username || 'user'}`}
        onClick={() => setOpen(message)}
        key={message.content}
        className="aspect-square h-20 w-20 rounded-xl cursor-pointer object-cover border border-border transition-transform hover:scale-[1.03]"
      />
    ));
    // eslint-disable-next-line react/no-array-index-key
    return (
      <div className="flex gap-2 mb-2" key={key}>
        {rowImages}
      </div>
    );
  });

  const onScroll = () => {
    if (scrollContainer.current) {
      setScrollHeight(scrollContainer.current.scrollHeight);
    }
  };

  const { people = [] } = room;

  const getStatus = (id) => {
    if (onlineUsers.filter((u) => u.id === id && u.status === 'busy').length > 0) return 'busy';
    if (onlineUsers.filter((u) => u.id === id && u.status === 'online').length > 0) return 'online';
    if (onlineUsers.filter((u) => u.id === id && u.status === 'away').length > 0) return 'away';
    return 'offline';
  };

  const members = people.map((person) => {
    const pInitials = `${(person.firstName || 'U').charAt(0)}${(person.lastName || '').charAt(0)}`.toUpperCase();

    return (
      <div key={person._id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <Avatar className="h-9 w-9 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
              {person.picture && (
                <img
                  src={`${Config.url || ''}/api/images/${person.picture.shieldedID}/256`}
                  alt=""
                  className="aspect-square size-full object-cover"
                />
              )}
              <AvatarFallback className="bg-transparent text-xs font-bold text-white">
                {pInitials}
              </AvatarFallback>
            </Avatar>
            <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card', STATUS_COLOR[getStatus(person._id)])} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">
              {person.firstName}
              {' '}
              {person.lastName}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">{`@${person.username}`}</div>
          </div>
        </div>
      </div>
    );
  });

  return (
    <div className="flex h-full w-full flex-col bg-card text-card-foreground overflow-y-auto">
      {/* Top Banner / Avatar Header */}
      <div className="flex flex-col items-center p-6 border-b border-border/60 text-center">
        <div className="relative mb-3">
          <Avatar className="h-20 w-20 border-2 border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-extrabold text-2xl shadow-md">
            {(room.isGroup ? room.picture : other.picture) && (
              <img
                src={`${Config.url || ''}/api/images/${(room.isGroup ? room.picture : other.picture).shieldedID}/256`}
                alt=""
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-2xl font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>

        <h3 className="text-sm font-bold text-foreground truncate max-w-[220px]">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {room.isGroup ? `${people.length} members in this group` : `@${other.username || 'user'}`}
        </p>
      </div>

      {/* Segmented Switcher (Members / Media) */}
      <div className="p-4">
        <div className="flex rounded-xl bg-muted/60 p-1">
          <button
            type="button"
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
              tab === 'members' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab('members')}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Members</span>
          </button>
          <button
            type="button"
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
              tab === 'media' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab('media')}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Media</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="mt-3">
          {tab === 'members' && (
            <div className="flex flex-col gap-0.5">
              {members}
            </div>
          )}

          {tab === 'media' && (
            <div
              className="flex flex-col overflow-y-auto"
              ref={scrollContainer}
              onScroll={onScroll}
            >
              {open && (
                <Lightbox
                  medium={`${Config.url || ''}/api/images/${open.content}/1024`}
                  large={`${Config.url || ''}/api/images/${open.content}/2048`}
                  alt="Lightbox"
                  hideDownload
                  onClose={() => setOpen(null)}
                />
              )}
              {images}
              {roomImages.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No images shared in this conversation yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Room;
