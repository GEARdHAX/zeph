import { useState, useRef, useEffect } from 'react';
import moment from 'moment';
import emojiRegex from 'emoji-regex';
import { useGlobal } from 'reactn';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import ReactImageAppear from 'react-image-appear';
import {
  DownloadCloud, Check, Clock, AlertCircle, MoreVertical, Trash2, Ban,
} from 'lucide-react';
import striptags from 'striptags';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import deleteMessage from '../../../actions/deleteMessage';
import Actions from '../../../constants/Actions';
import Config from '../../../config';

function Message({
  message, previous, next, onOpen, roomID,
}) {
  const { content, date, status } = message;
  let { author } = message;

  const user = useGlobal('user')[0] || {};
  const dispatch = useDispatch();
  const [confirmDeleteForEveryone, setConfirmDeleteForEveryone] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [menuOpen]);

  if (!author) author = { firstName: 'Deleted', lastName: 'User' };
  if (previous && !previous.author) previous.author = { firstName: 'Deleted', lastName: 'User' };
  if (next && !next.author) next.author = { firstName: 'Deleted', lastName: 'User' };

  const myId = String(user?.id || user?._id || '');
  const authorId = String(author?._id || author?.id || '');
  const isMine = !!myId && !!authorId && myId === authorId;

  let attachPrevious = false;
  let attachNext = false;

  const prevAuthorId = String(previous?.author?._id || previous?.author?.id || '');
  const nextAuthorId = String(next?.author?._id || next?.author?.id || '');

  if (
    previous
    && Math.abs(moment(previous.date).diff(moment(date), 'minutes')) < 3
    && prevAuthorId === authorId
  ) {
    attachPrevious = true;
  }

  if (
    next
    && Math.abs(moment(next.date).diff(moment(date), 'minutes')) < 3
    && nextAuthorId === authorId
  ) {
    attachNext = true;
  }

  const initials = `${(author.firstName || 'U').charAt(0)}${(author.lastName || '').charAt(0)}`.toUpperCase();

  function PictureOrSpacer() {
    if (isMine) return null;
    if (attachPrevious) return <div className="h-7 w-7 shrink-0" />;
    return (
      <Avatar className="h-7 w-7 shrink-0 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold">
        {author.picture && (
          <img
            src={`${Config.url || ''}/api/images/${author.picture.shieldedID}/256`}
            alt=""
            className="aspect-square size-full object-cover"
          />
        )}
        <AvatarFallback className="bg-transparent text-[10px] font-bold text-white">
          {initials}
        </AvatarFallback>
      </Avatar>
    );
  }

  const noEmoji = content ? content.replace(emojiRegex(), '') : '';
  const isOnlyEmoji = content && !noEmoji.replace(/[\s\n]/gm, '');

  const convertUrls = (text) => {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" class="underline hover:opacity-80">${url}</a>`);
  };

  const isDeleted = !!message.deletedForEveryone;

  function Content() {
    if (isDeleted) {
      return (
        <div className="flex items-center gap-1.5 text-xs italic text-muted-foreground/80">
          <Ban className="h-3.5 w-3.5" />
          This message was deleted
        </div>
      );
    }
    switch (message.type) {
      case 'image':
        return (
          <ReactImageAppear
            src={`${Config.url || ''}/api/images/${message.content}/512`}
            animationDuration="0.2s"
            className="rounded-xl max-h-[240px] w-auto object-cover cursor-pointer hover:opacity-95 transition-opacity"
            onClick={() => onOpen(message)}
          />
        );
      case 'file':
        return (
          <a
            href={`${Config.url || ''}/api/files/${message.content}`}
            download={message.file ? message.file.name : 'File'}
            className="flex items-center gap-2.5 p-0.5 text-inherit"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/15 dark:bg-white/15">
              <DownloadCloud className="h-4 w-4" />
            </div>
            <div className="min-w-0 pr-1">
              <div className="font-semibold text-xs truncate max-w-[200px]">{message.file ? message.file.name : 'Attachment'}</div>
              <div className="text-[10px] opacity-80 mt-0.5">
                {message.file ? `${Math.round((message.file.size / 1024 / 1024) * 10) / 10} MB` : '0 MB'}
              </div>
            </div>
          </a>
        );
      default:
        return (
          <div
            className="text-xs leading-relaxed break-words"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: convertUrls(striptags(content || '', ['a', 'strong', 'b', 'i', 'em', 'u', 'br'])),
            }}
          />
        );
    }
  }

  const isImage = message.type === 'image';

  const handleDeleteForMe = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setMenuOpen(false);
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteMessage({ roomID, messageID: message._id, forEveryone: false });
      dispatch({
        type: Actions.MESSAGE_DELETE, messageID: message._id, forEveryone: false,
      });
    } catch (err) {
      toast.error('Could not delete message. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteForEveryone = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await deleteMessage({ roomID, messageID: message._id, forEveryone: true });
      dispatch({
        type: Actions.MESSAGE_DELETE,
        messageID: message._id,
        forEveryone: true,
        deletedAt: res.data?.deletedAt,
      });
    } catch (err) {
      const reason = err?.response?.data?.reason;
      if (reason === 'deletion_window_expired') {
        toast.error('Too late to delete this for everyone.');
      } else {
        toast.error('Could not delete message. Please try again.');
      }
    } finally {
      setDeleting(false);
      setConfirmDeleteForEveryone(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'group flex w-full items-start gap-2 px-1 sm:px-2',
          isMine ? 'justify-end' : 'justify-start',
          attachPrevious ? 'pt-1' : 'pt-3',
          attachNext ? 'pb-1' : 'pb-2',
        )}
      >
        {!isMine && (
          <div className="shrink-0 pt-0.5">
            <PictureOrSpacer />
          </div>
        )}

        <div className={cn('flex flex-col max-w-[85%] sm:max-w-[70%]', isMine ? 'items-end' : 'items-start')}>
          {/* Author Name only on first message of consecutive group */}
          {!isMine && !attachPrevious && (
            <span className="mb-1 ml-1 text-[11px] font-semibold text-muted-foreground">
              {author.firstName}
              {' '}
              {author.lastName}
            </span>
          )}

          <div className={cn('relative flex items-center gap-1', isMine ? 'flex-row-reverse' : 'flex-row', menuOpen && 'z-30')}>
            {isOnlyEmoji ? (
              <div className="p-1 text-3xl">{content}</div>
            ) : (
              <div
                className={cn(
                  'relative rounded-2xl px-4 py-2.5 shadow-xs transition-all',
                  isMine
                    ? 'bg-primary text-primary-foreground rounded-br-xs'
                    : 'bg-muted text-foreground rounded-bl-xs border border-border/40',
                  isImage && 'p-1 bg-transparent border-0 shadow-none',
                  isDeleted && 'bg-muted/60 text-muted-foreground border border-border/40',
                )}
              >
                <Content />
              </div>
            )}

            {!isDeleted && (
              <div className="relative" ref={menuRef}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(!menuOpen);
                  }}
                  className={cn(
                    'h-6 w-6 shrink-0 rounded-full transition-opacity hover:bg-muted/80 cursor-pointer',
                    menuOpen ? 'opacity-100 bg-muted/80' : 'opacity-0 group-hover:opacity-100',
                  )}
                  aria-label="Message options"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>

                {menuOpen && (
                  <div
                    className={cn(
                      'absolute top-8 z-50 min-w-[150px] rounded-xl border border-border/80 bg-popover p-1 text-popover-foreground shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95',
                      isMine ? 'right-0' : 'left-0',
                    )}
                  >
                    <button
                      type="button"
                      onClick={handleDeleteForMe}
                      disabled={deleting}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Delete for me</span>
                    </button>
                    {isMine && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenuOpen(false);
                          setConfirmDeleteForEveryone(true);
                        }}
                        disabled={deleting}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                      >
                        <Ban className="h-3.5 w-3.5 text-destructive" />
                        <span>Delete for everyone</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timestamp on last message of group */}
          {!attachNext && (
            <div className={cn('flex items-center gap-1.5 px-1 pt-1 text-[10px] text-muted-foreground', isMine && 'justify-end')}>
              <span>{moment(date).format('MMM DD - h:mm A')}</span>
              {isMine && status === 'sending' && <Clock className="h-3 w-3 animate-spin text-muted-foreground" />}
              {isMine && status === 'sent' && <Check className="h-3 w-3 text-primary" />}
              {isMine && status === 'failed' && <AlertCircle className="h-3 w-3 text-destructive" />}
            </div>
          )}
        </div>
      </div>

      <Dialog open={confirmDeleteForEveryone} onOpenChange={setConfirmDeleteForEveryone}>
        <DialogContent className="rounded-2xl border border-border bg-card">
          <DialogHeader>
            <DialogTitle>Delete for everyone?</DialogTitle>
            <DialogDescription>
              This message will be removed for everyone in this chat. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setConfirmDeleteForEveryone(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl shadow-xs"
              onClick={handleDeleteForEveryone}
              disabled={deleting}
            >
              Delete for everyone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default Message;
