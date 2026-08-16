import { useState, useRef, useEffect } from 'react';
import { Lightbox } from 'react-modal-image';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import Message from './Message';
import Config from '../../../config';
import getMoreMessages from '../../../actions/getMoreMessages';
import Actions from '../../../constants/Actions';
import Picture from '../../../components/Picture';

function Messages() {
  const user = useGlobal('user')[0];
  const messages = useSelector((state) => state.io.messages) || [];
  const room = useSelector((state) => state.io.room);
  const [loading, setLoading] = useState(false);
  const typing = useSelector((state) => state.messages.typing);

  const dispatch = useDispatch();

  const chat = useRef(null);

  const [open, setOpen] = useState(null);

  let other = {
    firstName: 'A',
    lastName: 'A',
  };

  if (!room.isGroup && room.people) {
    room.people.forEach((person) => {
      if (person._id !== user.id) other = person;
    });
  }

  const messagesList = messages.map((message, index) => (
    <Message
      key={message._id || message.clientID}
      message={message}
      previous={messages[index - 1]}
      next={messages[index + 1]}
      onOpen={setOpen}
    />
  ));

  const onScroll = () => {
    if (chat.current.scrollTop === 0) {
      if (loading) return;
      setLoading(true);
      getMoreMessages({ roomID: room._id, firstMessageID: messages[0]._id })
        .then((res) => {
          dispatch({ type: Actions.MORE_MESSAGES, messages: res.data.messages });
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    }
  };

  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (typing && chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [typing]);

  return (
    <div
      className="flex h-full max-h-full w-full max-w-full justify-center overflow-y-auto overflow-x-hidden"
      style={{ minHeight: 'calc(100% - 55px - 55px)' }}
      ref={chat}
      onScroll={onScroll}
    >
      <div className="block max-w-[1000px] flex-1">
        {open && (
          <Lightbox
            medium={`${Config.url || ''}/api/images/${open.content}/1024`}
            large={`${Config.url || ''}/api/images/${open.content}/2048`}
            alt="Lightbox"
            hideDownload
            onClose={() => setOpen(null)}
          />
        )}
        {messagesList}
        {typing && (
          <div className="flex flex-1 flex-row px-[30px] pb-2.5 pt-0">
            <div className="-mb-5">
              <Picture user={other} />
            </div>
            <div className="flex min-w-[300px] max-w-[30%] flex-col">
              <div className="relative mx-3.5 w-5 rounded-[10px] rounded-tl-none bg-muted px-4 py-2">
                <div className="relative mx-auto text-center">
                  <span className="mr-0.5 inline-block h-[3px] w-[3px] animate-[wave_1.3s_linear_infinite] rounded-full bg-neutral-800" />
                  <span className="mr-0.5 inline-block h-[3px] w-[3px] animate-[wave_1.3s_linear_infinite] rounded-full bg-neutral-800 [animation-delay:-1.1s]" />
                  <span className="inline-block h-[3px] w-[3px] animate-[wave_1.3s_linear_infinite] rounded-full bg-neutral-800 [animation-delay:-0.9s]" />
                </div>
              </div>
              <div className="mx-3.5 p-1.5 text-[10px] text-transparent">-</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Messages;
