import { useEffect, useState } from 'react';
import {
  Bell, MessageSquare, Check, X,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import getFriendRequests from '../../../actions/getFriendRequests';
import respondFriendRequest from '../../../actions/respondFriendRequest';
import Config from '../../../config';

function NotificationsPlaceholder() {
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];
  const rooms = useSelector((state) => state.io.rooms) || [];
  const socket = useSelector((state) => state.io.io);
  const navigate = useNavigate();

  const [incoming, setIncoming] = useState([]);

  useEffect(() => {
    getFriendRequests()
      .then((res) => setIncoming(res.data.incoming || []))
      .catch(() => {});
  }, []);

  // Live-append a request that arrives while this page is already open —
  // without this, a request sent while the user was already sitting on
  // Notifications was invisible until they navigated away and back (the
  // fetch above only runs once, on mount). The toast in initIO.jsx covers
  // every other page; this covers the one page where a toast alone isn't
  // enough since the user is looking right at the (now stale) list.
  useEffect(() => {
    if (!socket) return undefined;
    const onReceived = (data) => {
      setIncoming((prev) => (prev.some((r) => r._id === data.relationship._id)
        ? prev
        : [{ ...data.relationship, requester: data.requester }, ...prev]));
    };
    socket.on('friend-request:received', onReceived);
    return () => socket.off('friend-request:received', onReceived);
  }, [socket]);

  const respond = async (id, action) => {
    try {
      await respondFriendRequest(id, action);
      setIncoming((prev) => prev.filter((r) => r._id !== id));
      toast.success(action === 'accept' ? 'Request accepted.' : 'Request declined.');
    } catch (err) {
      toast.error('Could not update that request.');
    }
  };

  const unreadRooms = rooms.filter((r) => roomsWithNewMessages.includes(r._id));

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      {/* Header */}
      <div data-tour="notifications-header" className="flex h-16 w-full shrink-0 items-center justify-between border-b border-border/60 bg-card px-6">
        <div>
          <h1 className="text-base font-bold text-foreground">Notifications</h1>
          <p className="text-xs text-muted-foreground">Recent alerts, unread messages, and mentions</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 max-w-4xl w-full mx-auto">
        {incoming.length > 0 && (
          <div className="flex flex-col gap-3 mb-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Friend Requests (
              {incoming.length}
              )
            </h2>
            {incoming.map((request) => {
              const person = request.requester || {};
              const fullName = `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.username;
              const initials = `${(person.firstName || 'U').charAt(0)}${(person.lastName || '').charAt(0)}`.toUpperCase();
              return (
                <div
                  key={request._id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card/60 p-4 transition-all hover:bg-card/90"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
                      {person.picture && (
                        <img
                          src={`${Config.url || ''}/api/images/${person.picture.shieldedID}/256`}
                          alt=""
                          className="aspect-square size-full object-cover"
                        />
                      )}
                      <AvatarFallback className="bg-transparent text-xs font-bold text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">{`@${person.username}`}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="icon" className="h-8 w-8 rounded-xl" onClick={() => respond(request._id, 'accept')}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-xl"
                      onClick={() => respond(request._id, 'decline')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {unreadRooms.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Unread Messages (
              {unreadRooms.length}
              )
            </h2>
            {unreadRooms.map((room) => (
              <div
                key={room._id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card/60 p-4 transition-all hover:bg-card/90"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{room.title || 'Conversation'}</div>
                    <div className="text-xs text-muted-foreground">{room.lastMessage?.content || 'New unread message'}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs gap-1.5"
                  onClick={() => navigate(`/room/${room._id}`)}
                >
                  View Chat
                </Button>
              </div>
            ))}
          </div>
        ) : (
          incoming.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Bell className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground">All Caught Up!</h2>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                You don&apos;t have any unread notifications or messages at the moment.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default NotificationsPlaceholder;
