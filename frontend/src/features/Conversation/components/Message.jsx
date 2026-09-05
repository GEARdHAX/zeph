import {
  memo, useState, useRef, useEffect, lazy, Suspense,
} from 'react';
import moment from 'moment';
import emojiRegex from 'emoji-regex';
import { useGlobal } from 'reactn';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import ReactImageAppear from 'react-image-appear';
import {
  DownloadCloud, Check, CheckCheck, Clock, AlertCircle, MoreVertical, Trash2, Ban, Copy, Languages,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import BioText from '../../../components/BioText';
import parseBio, { tokensToHtml } from '../../../lib/parseBio';
import deleteMessage from '../../../actions/deleteMessage';
import createRoom from '../../../actions/createRoom';
import translateMessage from '../../../actions/translateMessage';
import Actions from '../../../constants/Actions';
import Config from '../../../config';
import formatFileSize from '../../../lib/formatFileSize';
import LazyFallback from '../../../components/LazyFallback';
import { getAiErrorMessage } from '../../../lib/aiErrorMessage';

// Lazy-loaded so the profile viewer never ships in the initial chat bundle —
// only fetched the first time a user actually clicks a message author's
// avatar. Mirrors ImageEditorModal/MediaViewerShell's established pattern.
const ProfileView = lazy(() => import('../../Panel/components/ProfileView'));

// Phase 7 audit finding: rendered once per message in an unvirtualized
// list with zero memoization — any parent re-render (new message arriving,
// typing indicator, unrelated global state) re-rendered every bubble in
// the conversation, not just the changed one. memo() skips a re-render
// when this message's own props are referentially unchanged.
const TRANSLATE_LANGUAGES = ['Spanish', 'French', 'German', 'Hindi', 'Japanese', 'Arabic'];

function Message({
  message, previous, next, onOpen, roomID, aiEnabled,
}) {
  const { content, date, status } = message;
  let { author } = message;

  const user = useGlobal('user')[0] || {};
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [confirmDeleteForEveryone, setConfirmDeleteForEveryone] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewUsername, setPreviewUsername] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState(null); // { language, text } | null
  const [showLanguages, setShowLanguages] = useState(false);
  const menuRef = useRef(null);
  const translateAbortRef = useRef(null);
  useEffect(() => () => translateAbortRef.current?.abort(), []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
        setShowLanguages(false);
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

  // Moderation event ("X was removed by Y") — rendered as a centered pill
  // like DaySeparator's date divider, not a chat bubble: no author, no
  // avatar, no delete/copy menu, no read receipts. Bail out before the
  // author-fallback normalization below since a system message never had
  // an author to begin with — "Deleted User" would be misleading here.
  if (message.type === 'system') {
    return (
      <div className="flex items-center justify-center px-1 py-1.5 sm:px-2">
        <span className="rounded-full bg-muted/80 px-2.5 py-1 text-center text-[11px] font-medium text-muted-foreground shadow-xs">
          {content}
        </span>
      </div>
    );
  }

  if (!author) author = { firstName: 'Deleted', lastName: 'User' };
  if (previous && !previous.author) previous.author = { firstName: 'Deleted', lastName: 'User' };
  if (next && !next.author) next.author = { firstName: 'Deleted', lastName: 'User' };

  const myId = String(user?.id || user?._id || '');
  const authorId = String(author?._id || author?.id || '');
  const isMine = !!myId && !!authorId && myId === authorId;

  // Tick state for my own messages: sending (optimistic, no _id yet) ->
  // sent (persisted, status defaults to 'sent' for historical messages
  // that predate the optimistic-status field) -> delivered (someone else's
  // client acked receipt) -> read (someone else's readBy includes them).
  // Only meaningful for 1:1 rooms — a group has multiple recipients with
  // independent delivery/read state, so this single tri-state icon only
  // reflects "at least one other member" until per-member receipts matter.
  const otherHasIt = (list) => (list || []).some((id) => String(id?._id || id) !== authorId);
  const tickStatus = status === 'failed' || status === 'sending'
    ? status
    : (otherHasIt(message.readBy) ? 'read' : (otherHasIt(message.deliveredTo) ? 'delivered' : 'sent'));

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
    if (!author.username) {
      // Deleted/unknown author — nothing to preview, render the avatar inert.
      return (
        <Avatar className="h-7 w-7 shrink-0 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold">
          <AvatarFallback className="bg-transparent text-[10px] font-bold text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setPreviewUsername(author.username)}
        className="cursor-pointer"
        title={`View ${author.firstName || 'profile'}`}
      >
        <Avatar className="h-7 w-7 shrink-0 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold transition-opacity hover:opacity-85">
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
      </button>
    );
  }

  const noEmoji = content ? content.replace(emojiRegex(), '') : '';
  const isOnlyEmoji = content && !noEmoji.replace(/[\s\n]/gm, '');

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
      case 'file': {
        // New-format messages (upload-media.js) carry their attachment on
        // message.media; old-format ones carry it on message.file — never
        // both. Fall back to message.file so existing messages keep
        // rendering exactly as before.
        const attachment = message.media || message.file;
        return (
          <button
            type="button"
            onClick={() => onOpen(message)}
            className="flex items-center gap-2.5 p-0.5 text-inherit cursor-pointer text-left"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/15 dark:bg-white/15">
              <DownloadCloud className="h-4 w-4" />
            </div>
            <div className="min-w-0 pr-1">
              <div className="font-semibold text-xs truncate max-w-[200px]">
                {attachment ? (attachment.originalName || attachment.name) : 'Attachment'}
              </div>
              <div className="text-[10px] opacity-80 mt-0.5">
                {attachment ? formatFileSize(attachment.size) : 'Unknown size'}
              </div>
            </div>
          </button>
        );
      }
      default:
        return (
          <BioText
            text={content}
            onMentionClick={setPreviewUsername}
            className="block text-xs leading-relaxed break-words"
          />
        );
    }
  }

  const isImage = message.type === 'image';

  const openChatWith = async (targetUserID) => {
    setPreviewUsername(null);
    try {
      const res = await createRoom(targetUserID);
      dispatch({ type: Actions.SET_ROOM, room: res.data.room });
      dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
      navigate(`/room/${res.data.room._id}`);
    } catch (err) {
      toast.error('Could not start chat.');
    }
  };

  // Copies the message exactly as it renders: text/plain gets the raw
  // content (the app's own **bold**/@mention/etc. markdown-like syntax,
  // the same thing that's actually stored — the most faithful "plain text"
  // representation now that content is never HTML), and text/html gets the
  // same tokens the bubble itself renders (via parseBio + BioText)
  // serialized to real HTML tags, so pasting into a rich-text target
  // (email, doc, another chat) keeps bold/italic/links intact instead of
  // showing the raw ** markers.
  const handleCopy = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setMenuOpen(false);
    const plain = content || '';
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const html = tokensToHtml(parseBio(plain));
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      toast.success('Message copied.');
    } catch (err) {
      toast.error('Could not copy message.');
    }
  };

  const handleTranslate = async (language) => {
    setMenuOpen(false);
    if (translating || !content) return;
    setTranslating(true);
    translateAbortRef.current?.abort();
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
      const res = await translateMessage(content, language, controller.signal);
      setTranslation({ language, text: res.data.translation });
    } catch (err) {
      if (err.code === 'ERR_CANCELED') return;
      toast.error(getAiErrorMessage(err));
    } finally {
      setTranslating(false);
    }
  };

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
                    {!isImage && message.type !== 'file' && content && (
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>Copy</span>
                      </button>
                    )}
                    {aiEnabled && !isImage && message.type !== 'file' && content && !showLanguages && (
                      <button
                        type="button"
                        disabled={translating}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowLanguages(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Languages className={cn('h-3.5 w-3.5 text-muted-foreground', translating && 'animate-spin')} />
                        <span>{translating ? 'Translating…' : 'Translate'}</span>
                      </button>
                    )}
                    {aiEnabled && showLanguages && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowLanguages(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
                        >
                          <span>← Back</span>
                        </button>
                        {TRANSLATE_LANGUAGES.map((language) => (
                          <button
                            key={language}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setShowLanguages(false);
                              handleTranslate(language);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 pl-6 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
                          >
                            <span>{language}</span>
                          </button>
                        ))}
                      </>
                    )}
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

          {translation && (
            <div className={cn('mt-1 max-w-full rounded-xl border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground', isMine && 'text-right')}>
              <span className="font-semibold text-foreground">
                {translation.language}
                :
                {' '}
              </span>
              {translation.text}
            </div>
          )}

          {/* Timestamp on last message of group */}
          {!attachNext && (
            <div className={cn('flex items-center gap-1.5 px-1 pt-1 text-[10px] text-muted-foreground', isMine && 'justify-end')}>
              <span>{moment(date).format('MMM DD - h:mm A')}</span>
              {isMine && tickStatus === 'sending' && <Clock className="h-3 w-3 animate-spin text-muted-foreground" />}
              {isMine && tickStatus === 'failed' && <AlertCircle className="h-3 w-3 text-destructive" />}
              {isMine && tickStatus === 'sent' && <Check className="h-3 w-3 text-primary" />}
              {isMine && tickStatus === 'delivered' && <CheckCheck className="h-3 w-3 text-primary" />}
              {isMine && tickStatus === 'read' && <CheckCheck className="h-3 w-3 text-sky-500" />}
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

      {previewUsername && (
        <Suspense fallback={<LazyFallback />}>
          <ProfileView
            username={previewUsername}
            onClose={() => setPreviewUsername(null)}
            onOpenChat={openChatWith}
          />
        </Suspense>
      )}
    </>
  );
}

export default memo(Message);
