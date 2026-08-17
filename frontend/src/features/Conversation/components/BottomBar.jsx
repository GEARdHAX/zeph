import { useRef, useState, useEffect } from 'react';
import {
  Send, Image, Smile, Paperclip, Sparkles,
} from 'lucide-react';
import { useGlobal } from 'reactn';
import moment from 'moment';
import { useDispatch, useSelector } from 'react-redux';
import Picker from '@emoji-mart/react';
import { Button } from '@/components/ui/button';
import message from '../../../actions/message';
import uploadImage from '../../../actions/uploadImage';
import uploadFile from '../../../actions/uploadFile';
import Actions from '../../../constants/Actions';
import getRooms from '../../../actions/getRooms';
import typing from '../../../actions/typing';
import retryWithBackoff from '../../../lib/retryWithBackoff';
import draftReply from '../../../actions/draftReply';
import useTheme from '../../../lib/useTheme';

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

  const dispatch = useDispatch();
  const typingTimeout = useRef(null);

  useEffect(() => {
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

    const sendRequest = () => message({ roomID: room._id, content: text, contentType: 'text' });

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
        dispatch({ type: Actions.MESSAGE_UPDATE, clientID, patch: { status: 'failed' } });
      });
  };

  const handleKeyPress = (event) => {
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

  const sendImages = async (files) => {
    const tmpRefs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      tmpRefs.push(ref + i);
      const res = await uploadImage(file, ref + i);
      message({
        roomID: room._id,
        authorID: user.id,
        content: res.data.image.shieldedID,
        type: 'image',
        imageID: res.data.image._id,
      });
      const newMessage = {
        _id: Math.random(),
        author: { ...user, _id: user.id },
        content: res.data.image.shieldedID,
        type: 'image',
        date: moment(),
      };
      dispatch({ type: Actions.MESSAGE, message: newMessage });
    }
    addPictureRef([...pictureRefs, ...tmpRefs]);
    showPicker(false);
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
  };

  const sendFiles = async (files) => {
    const tmpRefs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      tmpRefs.push(ref + i);
      const res = await uploadFile(file, ref + i);
      message({
        roomID: room._id,
        authorID: user.id,
        content: res.data.file.shieldedID,
        type: 'file',
        fileID: res.data.file._id,
      });
      const newMessage = {
        _id: Math.random(),
        author: { ...user, _id: user.id },
        content: res.data.file.shieldedID,
        type: 'file',
        date: moment(),
        file: res.data.file,
      };
      dispatch({ type: Actions.MESSAGE, message: newMessage });
    }
    addPictureRef([...pictureRefs, ...tmpRefs]);
    showPicker(false);
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
  };

  return (
    <div className="relative flex w-full items-center gap-2 border-t border-border/60 bg-card px-3.5 pt-3 pb-6 sm:py-2.5 text-card-foreground">
      {isPicker && (
        <div className="absolute bottom-[84px] left-4 z-50 shadow-2xl rounded-2xl overflow-hidden border border-border">
          <Picker
            onSelect={(emoji) => setText((prev) => prev + (emoji.native || ''))}
            theme={theme === 'dark' ? 'dark' : 'light'}
            title="Emoji"
            native
          />
        </div>
      )}

      <div className="flex items-center gap-0.5 text-muted-foreground shrink-0">
        <Button
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
          onChange={(e) => sendImages(e.target.files)}
        />
        <Button
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
          onChange={(e) => sendFiles(e.target.files)}
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

      {/* Text input with clean rounded container */}
      <div className="relative flex-1 flex items-center">
        <input
          className="h-10 w-full rounded-xl border border-input bg-muted/40 px-3.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20"
          type="text"
          placeholder="Type something to send..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyPress={handleKeyPress}
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
          size="icon"
          className="h-9 w-9 rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          aria-label="Send message"
          onClick={sendMessage}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default BottomBar;
