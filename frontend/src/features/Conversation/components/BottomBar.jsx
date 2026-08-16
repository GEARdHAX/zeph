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

function BottomBar({ aiEnabled }) {
  const imageInput = useRef(null);
  const fileInput = useRef(null);

  const ref = useGlobal('ref')[0];
  const room = useSelector((state) => state.io.room);
  const user = useGlobal('user')[0];

  const [text, setText] = useState('');
  const [isPicker, showPicker] = useGlobal('isPicker');
  const [pictureRefs, addPictureRef] = useState([]);
  const [drafting, setDrafting] = useState(false);

  const dispatch = useDispatch();
  const typingTimeout = useRef(null);

  // Debounced: a "typing" POST per keystroke wastes data on slow/metered connections.
  // Only the "stopped typing" signal (text cleared) needs to fire immediately.
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
    if (text.length === 0) return;

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
    showPicker(false);
    if (event.key === 'Enter') sendMessage();
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

  // ponytail: image/file sends still use the old fire-and-forget fake-_id pattern with no
  // retry/failure UI — upload retry needs re-sendable FormData, a bigger change than the
  // text-message retry above. Apply the same clientID+retryWithBackoff treatment here if
  // upload reliability on flaky networks becomes a reported problem.
  const sendImages = async (images) => {
    const tmpRefs = [];
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      tmpRefs.push(ref + i);
      const res = await uploadImage(image, ref + i);
      message({
        roomID: room._id,
        authorID: user.id,
        content: res.data.image.shieldedID,
        type: 'image',
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
    for (let i = 0; i < files.length; i++) {
      if (files[i].size / (1024 * 1024) > 10) {
        alert('File exceeds 10MB limit!');
        return;
      }
    }
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
    <div className="relative flex min-h-[54px] max-h-[54px] w-full items-center border-t bg-card">
      {isPicker && (
        <div className="absolute bottom-[451px] left-0">
          <Picker onSelect={(emoji) => setText(text + emoji.native)} theme="light" title="Emoji" native />
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="mx-2"
        aria-label="Toggle emoji picker"
        onClick={() => showPicker(!isPicker)}
      >
        <Smile />
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
        aria-label="Attach image"
        onClick={() => imageInput && imageInput.current && imageInput.current.click()}
      >
        <Image />
      </Button>
      <input className="hidden" type="file" ref={fileInput} multiple onChange={(e) => sendFiles(e.target.files)} />
      <Button
        variant="ghost"
        size="icon"
        className="mx-2"
        aria-label="Attach file"
        onClick={() => fileInput && fileInput.current && fileInput.current.click()}
      >
        <Paperclip />
      </Button>
      <input
        className="h-10 w-full flex-1 bg-transparent px-2 text-sm outline-none"
        type="text"
        placeholder="Type something to send..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyPress={handleKeyPress}
        onFocus={() => showPicker(false)}
      />
      {aiEnabled && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Draft reply with AI"
          disabled={drafting}
          onClick={draft}
        >
          <Sparkles />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="mr-2" aria-label="Send message" onClick={sendMessage}>
        <Send />
      </Button>
    </div>
  );
}

export default BottomBar;
