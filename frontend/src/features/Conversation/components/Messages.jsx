import { useState, useRef, useEffect } from 'react';
import { Lightbox } from 'react-modal-image';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import moment from 'moment';
import Message from './Message';
import Config from '../../../config';
import getMoreMessages from '../../../actions/getMoreMessages';
import Actions from '../../../constants/Actions';
import Picture from '../../../components/Picture';

const dayLabel = (date) => {
  const m = moment(date);
  if (m.isSame(moment(), 'day')) return 'Today';
  if (m.isSame(moment().subtract(1, 'day'), 'day')) return 'Yesterday';
  return m.format('MMMM D, YYYY');
};

function DaySeparator({ date }) {
  return (
    <div className="flex items-center gap-3 px-1 py-1.5 sm:px-2">
      <div className="h-px flex-1 bg-border/60" />
      <span className="shrink-0 rounded-full bg-muted/80 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs">
        {dayLabel(date)}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function Messages() {
  const user = useGlobal('user')[0] || {};
  const messages = useSelector((state) => state.io.messages) || [];
  const room = useSelector((state) => state.io.room) || {};
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

  const messagesList = messages.map((message, index) => {
    const previous = messages[index - 1];
    const showDaySeparator = !previous || !moment(message.date).isSame(moment(previous.date), 'day');

    return (
      <div key={message._id || message.clientID}>
        {showDaySeparator && <DaySeparator date={message.date} />}
        <Message
          message={message}
          previous={previous}
          next={messages[index + 1]}
          onOpen={setOpen}
          roomID={room._id}
        />
      </div>
    );
  });

  const onScroll = () => {
    if (chat.current && chat.current.scrollTop === 0) {
      if (loading || !messages.length) return;
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
    if (chat.current) {
      chat.current.scrollTop = chat.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (typing && chat.current) {
      chat.current.scrollTop = chat.current.scrollHeight;
    }
  }, [typing]);

  return (
    <div
      className="relative z-0 flex-1 w-full overflow-y-auto overflow-x-hidden flex justify-center py-2 bg-transparent"
      ref={chat}
      onScroll={onScroll}
    >
      <div className="flex flex-col w-full mx-auto px-4 sm:px-6 md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
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

        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <div className="text-sm font-semibold text-foreground">No messages here yet</div>
            <div className="text-xs text-muted-foreground mt-1">Send a message to start the conversation!</div>
          </div>
        )}

        {typing && (
          <div className="flex w-full items-end gap-2 px-4 sm:px-6 py-0.5">
            <div className="h-7 w-7 shrink-0">
              <Picture user={other} />
            </div>
            <div className="flex flex-col items-start">
              <div className="relative rounded-2xl bg-muted px-3 py-2 border border-border/40">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Messages;
