import {
  useRef, useState, useEffect, lazy, Suspense,
} from 'react';
import {
  Send, Image, Smile, Paperclip, Sparkles, ShieldOff, Trash2,
} from 'lucide-react';
import { useGlobal } from 'reactn';
import moment from 'moment';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { Button } from '@/components/ui/button';
import message from '../../../actions/message';
import uploadImage from '../../../actions/uploadImage';
import uploadMedia from '../../../actions/uploadMedia';
import Actions from '../../../constants/Actions';
import getRooms from '../../../actions/getRooms';
import typing from '../../../actions/typing';
import retryWithBackoff from '../../../lib/retryWithBackoff';
import draftReply from '../../../actions/draftReply';
import deleteConversation from '../../../actions/deleteConversation';
import useTheme from '../../../lib/useTheme';
import { validateFile } from '../../../lib/mediaPolicy';
import RichMessageInput from './RichMessageInput';
import LazyFallback from '../../../components/LazyFallback';

// Lazy-loaded so react-easy-crop is only fetched the first time a user
// actually attaches an image, not bundled into the initial chat load.
const ImageEditorModal = lazy(() => import('./ImageEditorModal'));
// Lazy-loaded — MediaRecorder-based trim editor, only fetched the first
// time a user actually attaches a video.
const VideoEditorModal = lazy(() => import('./VideoEditorModal'));

function BottomBar({ aiEnabled }) {
  const imageInput = useRef(null);
  const fileInput = useRef(null);

  const ref = useGlobal('ref')[0];
  const room = useSelector((state) => state.io.room);
  const user = useGlobal('user')[0] || {};
  const { theme } = useTheme();

  const [text, setText] = useState('');
  const [isPicker, showPicker] = useGlobal('isPicker');
  const [pictureRefs, addPictureRef] = useState([]);
  const [drafting, setDrafting] = useState(false);

  // Image-editor queue — component-local only (never global/Redux), per
  // the feature's own requirement. editorQueue holds raw Files still
  // waiting to be edited (one at a time); editedFiles accumulates the
  // already-cropped Files until the whole queue is done, at which point
  // they're handed to the existing sendImages() unchanged.
  const [editorQueue, setEditorQueue] = useState([]);
  const [editedFiles, setEditedFiles] = useState([]);

  // Same one-at-a-time queue pattern for video trimming — a separate queue
  // from images since they use different editor modals with different
  // onDone shapes (video's onDone also carries a poster frame Blob).
  const [videoQueue, setVideoQueue] = useState([]);

  // Upload progress — keyed by a locally-generated id so concurrent
  // multi-file sends each get their own bar. Real-world-network-first: on a
  // slow/unstable connection an image/video/file upload can take seconds to
  // minutes, and until now uploadImage/uploadMedia's onProgress callback was
  // silently discarded (both actions already report real byte progress via
  // axios's onUploadProgress — see uploadImage.js/uploadMedia.js), so a user
  // had zero feedback between picking a file and the message appearing.
  const [uploadProgress, setUploadProgress] = useState([]);
  const setProgressFor = (id, percent) => setUploadProgress((prev) => prev.map(
    (item) => (item.id === id ? { ...item, percent } : item),
  ));

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const typingTimeout = useRef(null);

  const pickerRef = useRef(null);

  const [deletingConversation, setDeletingConversation] = useState(false);

  // Set live by ROOM_ACCESS_REVOKED (reducers/io.js) when a
  // group:member:removed{self:true} event arrives for the currently-open
  // room — see initIO.jsx. reason 'left' (the user's own deliberate leave)
  // never sets this, only 'removed'/'banned'/'deleted' do.
  const accessRevoked = room?.accessRevoked;

  const onDeleteConversation = async () => {
    if (!room?._id) return;
    setDeletingConversation(true);
    try {
      await deleteConversation(room._id);
      toast.success('Conversation removed from your inbox.');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error('Could not delete this conversation.');
      setDeletingConversation(false);
    }
  };

  useEffect(() => {
    const handleOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        showPicker(false);
      }
    };
    if (isPicker) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('touchstart', handleOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isPicker]);

  useEffect(() => {
    if (accessRevoked) return undefined;
    if (text === '') {
      clearTimeout(typingTimeout.current);
      dispatch(typing(room, false));
      return undefined;
    }
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => dispatch(typing(room, true)), 1500);
    return () => clearTimeout(typingTimeout.current);
  }, [text]);

  const sendMessage = () => {
    if (text.trim().length === 0) return;

    const clientID = crypto.randomUUID();
    const newMessage = {
      clientID,
      author: { ...user, _id: user.id },
      content: text,
      type: 'text',
      date: moment(),
      status: 'sending',
    };
    dispatch({ type: Actions.MESSAGE, message: newMessage });
    setText('');
    showPicker(false);

    // message.js (backend) reads req.fields.type, not contentType — this
    // previously sent the wrong field name, so every real text message was
    // persisted with type: undefined. Harmless as long as nothing needed
    // to distinguish "text" from "everything else" by reading
    // message.type, but that's exactly what the message-toast preview
    // does (previewText in initIO.jsx) — undefined !== 'file' made
    // getMediaCategory() default every text message to the 'file'
    // category, showing "Sent a file" instead of the real text.
    const sendRequest = () => message({ roomID: room._id, content: text, type: 'text' });

    retryWithBackoff(sendRequest)
      .then((res) => {
        dispatch({
          type: Actions.MESSAGE_UPDATE,
          clientID,
          patch: { _id: res.data.message._id, status: 'sent' },
        });
        getRooms()
          .then((res2) => dispatch({ type: Actions.SET_ROOMS, rooms: res2.data.rooms }))
          .catch((err) => console.log(err));
      })
      .catch((err) => {
        console.log(err);
        if (err.response?.data?.reason === 'SLOW_MODE') {
          toast.error('Slow mode is on — wait a moment before sending another message.');
        }
        dispatch({ type: Actions.MESSAGE_UPDATE, clientID, patch: { status: 'failed' } });
      });
  };

  // onKeyDown, not onKeyPress — a contentEditable div's default Enter
  // behavior (inserting a new block/line) can only be reliably intercepted
  // via keydown; keypress doesn't fire for Enter consistently across
  // browsers on contentEditable elements the way it does on <input>.
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      showPicker(false);
      sendMessage();
    }
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const res = await draftReply(room._id);
      setText(res.data.draft);
    } catch (e) {
      console.log(e);
    } finally {
      setDrafting(false);
    }
  };

  // Image attach button entry point — validates then stages the queue
  // instead of uploading directly; sendImages() below is only ever called
  // once every selected image has been through the editor.
  const selectImages = (fileList) => {
    const files = Array.from(fileList);
    const validFiles = files.filter((file) => {
      const { valid, category, error } = validateFile(file);
      if (!valid || category !== 'image') {
        toast.error(error || `${file.name}: unsupported image type.`);
        return false;
      }
      return true;
    });
    if (validFiles.length) setEditorQueue(validFiles);
  };

  // General attach button entry point — routes each selected file by
  // category: images/videos go through their respective editor queues
  // first (never uploaded until the user confirms Done), everything else
  // (audio/pdf/document/archive/text) uploads straight away with no
  // editor step, matching the plan's "for normal documents: select ->
  // validate -> upload -> message -> send" flow exactly.
  const selectAttachments = (fileList) => {
    const files = Array.from(fileList);
    const images = [];
    const videos = [];
    const straightToUpload = [];

    files.forEach((file) => {
      const { valid, category, error } = validateFile(file);
      if (!valid) {
        toast.error(error);
        return;
      }
      if (category === 'image') images.push(file);
      else if (category === 'video') videos.push(file);
      else straightToUpload.push(file);
    });

    if (images.length) setEditorQueue((prev) => [...prev, ...images]);
    if (videos.length) setVideoQueue((prev) => [...prev, ...videos]);
    if (straightToUpload.length) sendGenericMedia(straightToUpload);
  };

  // Cancel discards the ENTIRE remaining queue, not just the image
  // currently being edited — nothing partially edited gets uploaded.
  const cancelImageEditor = () => {
    setEditorQueue([]);
    setEditedFiles([]);
  };

  // Advances to the next queued image, or — once the last one is edited —
  // hands the whole batch to the existing sendImages() unchanged.
  const finishImageEdit = (editedFile) => {
    const nextQueue = editorQueue.slice(1);
    const nextEdited = [...editedFiles, editedFile];
    if (nextQueue.length === 0) {
      setEditedFiles([]);
      sendImages(nextEdited);
    } else {
      setEditedFiles(nextEdited);
    }
    setEditorQueue(nextQueue);
  };

  // Video editor discards its ENTIRE remaining queue on cancel, same
  // contract as the image editor — nothing partially trimmed gets uploaded.
  const cancelVideoEditor = () => {
    setVideoQueue([]);
  };

  // Videos upload one at a time as soon as each is trimmed (rather than
  // batching like images) since a trimmed video is already a single final
  // file with no further combining step needed.
  const finishVideoEdit = async (trimmedFile, posterBlob) => {
    setVideoQueue((prev) => prev.slice(1));
    await sendGenericMedia([trimmedFile], posterBlob);
  };

  const sendImages = async (files) => {
    const tmpRefs = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        tmpRefs.push(ref + i);
        const progressId = crypto.randomUUID();
        setUploadProgress((prev) => [...prev, { id: progressId, name: file.name, percent: 0 }]);
        const onUploadProgress = (event) => {
          if (!event.total) return;
          setProgressFor(progressId, Math.round((event.loaded / event.total) * 100));
        };
        let res;
        try {
          res = await uploadImage(file, ref + i, onUploadProgress);
        } finally {
          setUploadProgress((prev) => prev.filter((item) => item.id !== progressId));
        }
        const clientID = crypto.randomUUID();
        const newMessage = {
          clientID,
          author: { ...user, _id: user.id },
          content: res.data.image.shieldedID,
          type: 'image',
          date: moment(),
        };
        dispatch({ type: Actions.MESSAGE, message: newMessage });
        // eslint-disable-next-line no-await-in-loop
        const msgRes = await message({
          roomID: room._id,
          authorID: user.id,
          content: res.data.image.shieldedID,
          type: 'image',
          imageID: res.data.image._id,
        });
        dispatch({ type: Actions.MESSAGE_UPDATE, clientID, patch: { _id: msgRes.data.message._id } });
      }
    } catch (err) {
      // Pre-existing gap this progress-bar pass also closes: an upload
      // failure here used to throw from an un-awaited, un-caught call
      // (finishImageEdit calls sendImages() fire-and-forget) — silently, no
      // toast, nothing — a real problem on the flaky connections this app
      // targets. Whatever succeeded before the failure (earlier files in a
      // multi-select batch) stays sent; only the failure itself surfaces now.
      toast.error('Could not send image. Check your connection and try again.');
    }
    addPictureRef([...pictureRefs, ...tmpRefs]);
    showPicker(false);
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
  };

  // Unified send path for every category EXCEPT image (audio/pdf/document/
  // archive/text upload straight away; video arrives here already trimmed,
  // with an optional poster frame Blob captured client-side during
  // editing). Uses the new unified upload-media endpoint and Message.media
  // ref — the legacy uploadFile/fileID path stays untouched for whatever
  // still calls it elsewhere, this is purely additive.
  const sendGenericMedia = async (files, posterBlob) => {
    const tmpRefs = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        tmpRefs.push(ref + i);
        const progressId = crypto.randomUUID();
        setUploadProgress((prev) => [...prev, { id: progressId, name: file.name, percent: 0 }]);
        const onUploadProgress = (event) => {
          if (!event.total) return;
          setProgressFor(progressId, Math.round((event.loaded / event.total) * 100));
        };
        let res;
        try {
          // eslint-disable-next-line no-await-in-loop
          res = await uploadMedia(file, onUploadProgress, posterBlob);
        } finally {
          setUploadProgress((prev) => prev.filter((item) => item.id !== progressId));
        }
        const { media } = res.data;
        const clientID = crypto.randomUUID();
        const newMessage = {
          clientID,
          author: { ...user, _id: user.id },
          content: media._id,
          type: 'file',
          date: moment(),
          media,
        };
        dispatch({ type: Actions.MESSAGE, message: newMessage });
        // eslint-disable-next-line no-await-in-loop
        const msgRes = await message({
          roomID: room._id,
          authorID: user.id,
          content: media._id,
          type: 'file',
          mediaID: media._id,
        });
        dispatch({ type: Actions.MESSAGE_UPDATE, clientID, patch: { _id: msgRes.data.message._id } });
      }
    } catch (err) {
      // Same pre-existing fire-and-forget gap as sendImages() above — both
      // call sites (selectAttachments' straight-to-upload path, and
      // finishVideoEdit) invoke this without a caller-side catch.
      toast.error('Could not send file. Check your connection and try again.');
    }
    addPictureRef([...pictureRefs, ...tmpRefs]);
    showPicker(false);
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
  };

  if (accessRevoked) {
    const actionLabel = accessRevoked.reason === 'banned' ? 'banned from' : 'removed from';
    return (
      <div className="flex w-full flex-col items-center gap-2.5 border-t border-border/60 bg-card px-3.5 py-4 text-center text-card-foreground">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive">
          <ShieldOff className="h-4 w-4 shrink-0" />
          <span>
            {`You were ${actionLabel} this group`}
            {accessRevoked.actorName ? ` by ${accessRevoked.actorName}` : ''}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={deletingConversation}
          onClick={onDeleteConversation}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deletingConversation ? 'Removing…' : 'Delete Group DM'}
        </Button>
      </div>
    );
  }

  return (
    <div data-tour="message-composer" className="relative flex w-full items-center gap-2 border-t border-border/60 bg-card px-3.5 pt-3 pb-6 sm:py-2.5 text-card-foreground">
      {uploadProgress.length > 0 && (
        <div className="absolute -top-1.5 left-3.5 right-3.5 flex -translate-y-full flex-col gap-1.5 rounded-xl border border-border/60 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
          {uploadProgress.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 tabular-nums">{`${item.percent}%`}</span>
              <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${item.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {isPicker && (
        <div ref={pickerRef} className="absolute bottom-[84px] left-4 z-50 shadow-2xl rounded-2xl overflow-hidden border border-border">
          <Picker
            data={data}
            onEmojiSelect={(emoji) => setText((prev) => prev + (emoji.native || ''))}
            theme={theme === 'dark' ? 'dark' : 'light'}
            title="Emoji"
          />
        </div>
      )}

      <div className="flex items-center gap-0.5 text-muted-foreground shrink-0">
        <Button
          data-tour="emoji-button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full hover:text-foreground"
          aria-label="Toggle emoji picker"
          onClick={() => showPicker(!isPicker)}
        >
          <Smile className="h-4 w-4" />
        </Button>

        <input
          className="hidden"
          type="file"
          ref={imageInput}
          accept="image/*"
          multiple
          onChange={(e) => {
            selectImages(e.target.files);
            e.target.value = ''; // allow re-selecting the same file(s) again later
          }}
        />
        <Button
          data-tour="attachment-button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full hover:text-foreground"
          aria-label="Attach image"
          onClick={() => imageInput?.current?.click()}
        >
          <Image className="h-4 w-4" />
        </Button>

        <input
          className="hidden"
          type="file"
          ref={fileInput}
          multiple
          onChange={(e) => {
            selectAttachments(e.target.files);
            e.target.value = ''; // allow re-selecting the same file(s) again later
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full hover:text-foreground"
          aria-label="Attach file"
          onClick={() => fileInput?.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
      </div>

      {/* Text input with clean rounded container — contentEditable, not a
          plain input, so bold/italic/etc formatting syntax can be
          live-styled as the user types (see RichMessageInput.jsx for why a
          plain input can't do this at all). */}
      <div data-tour="message-input" className="relative flex-1 flex items-center">
        <RichMessageInput
          className="flex h-10 w-full items-center overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-xl border border-input bg-muted/40 px-3.5 text-xs text-foreground outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20"
          placeholder="Type something to send..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => showPicker(false)}
        />
      </div>

      <div className="flex items-center gap-1.5 ml-2">
        {aiEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
            aria-label="Draft reply with AI"
            disabled={drafting}
            onClick={draft}
            title="Draft with AI"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        )}

        <Button
          data-tour="send-button"
          size="icon"
          className="h-9 w-9 rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          aria-label="Send message"
          onClick={sendMessage}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {editorQueue.length > 0 && (
        <Suspense fallback={<LazyFallback />}>
          <ImageEditorModal
            file={editorQueue[0]}
            onCancel={cancelImageEditor}
            onDone={finishImageEdit}
          />
        </Suspense>
      )}

      {videoQueue.length > 0 && (
        <Suspense fallback={<LazyFallback />}>
          <VideoEditorModal
            file={videoQueue[0]}
            onCancel={cancelVideoEditor}
            onDone={finishVideoEdit}
          />
        </Suspense>
      )}
    </div>
  );
}

export default BottomBar;
