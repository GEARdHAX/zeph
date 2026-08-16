import { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useGlobal } from 'reactn';
import { Lightbox } from 'react-modal-image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Config from '../../../config';

const STATUS_COLOR = {
  online: 'bg-emerald-500',
  away: 'bg-orange-500',
  busy: 'bg-destructive',
  offline: 'bg-gray-400',
};

function Room() {
  const room = useSelector((state) => state.io.room);
  const onlineUsers = useSelector((state) => state.io.onlineUsers);
  const imagesNumber = useSelector((state) => state.io.room.images.length);
  const user = useGlobal('user')[0];

  const scrollContainer = useRef(null);

  const [scrollHeight, setScrollHeight] = useState(0);
  const [open, setOpen] = useState(null);
  const [viewMembers, setViewMembers] = useState(false);

  useEffect(() => {
    if (scrollContainer.current.scrollTop === 0) scrollContainer.current.scrollTop = scrollHeight;
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

  function Picture({ picture, user: pictureUser, group }) {
    if (picture) {
      return (
        <img
          src={`${Config.url || ''}/api/images/${picture.shieldedID}/256`}
          alt="Picture"
          className="h-full w-full object-cover"
        />
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-secondary text-secondary-foreground">
        {group ? room.title.substr(0, 1) : `${pictureUser.firstName.substr(0, 1)}${pictureUser.lastName.substr(0, 1)}`}
      </div>
    );
  }

  const rows = [];
  let row = [];

  room.images.forEach((message) => {
    row.push(message);
    if (row.length === 2) {
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
        alt={`Sent by @${message.author.username}`}
        onClick={() => setOpen(message)}
        key={message.content}
        className="mb-0.5 h-[147px] w-[147px] flex-1 cursor-pointer object-cover first:ml-0.5 last:mr-0.5"
      />
    ));
    // eslint-disable-next-line react/no-array-index-key
    return (
      <div className="flex min-h-[149px] flex-row" key={key}>
        {rowImages}
      </div>
    );
  });

  const onScroll = () => {
    setScrollHeight(scrollContainer.current.scrollHeight);
  };

  function Notice() {
    if (images.length === 0) {
      return (
        <div className="p-5 text-center text-sm text-muted-foreground">
          There are no images in this conversation yet.
        </div>
      );
    }
    return null;
  }

  const compare = (a, b) => {
    if (a.firstName < b.firstName) return -1;
    if (a.firstName > b.firstName) return 1;
    if (a.lastName < b.lastName) return -1;
    if (a.lastName > b.lastName) return 1;
    return 0;
  };

  const { people } = room;

  people.sort(compare);

  const getStatus = (id) => {
    if (onlineUsers.filter((u) => u.id === id && u.status === 'busy').length > 0) return 'busy';
    if (onlineUsers.filter((u) => u.id === id && u.status === 'online').length > 0) return 'online';
    if (onlineUsers.filter((u) => u.id === id && u.status === 'away').length > 0) return 'away';
    return 'offline';
  };

  const members = people.map((person) => (
    <div key={person._id} className="flex h-[54px] items-center border-b text-sm last:border-b-0">
      <div className="mx-4 h-10 w-10 shrink-0 overflow-hidden rounded-full">
        <Picture picture={person.picture} user={person} />
      </div>
      <div className="flex-1">{`${person.firstName} ${person.lastName}`}</div>
      <span className={cn('mr-4 h-2.5 w-2.5 shrink-0 rounded-full', STATUS_COLOR[getStatus(person._id)])} />
    </div>
  ));

  return (
    <div className="flex h-full min-w-[280px] flex-col items-center overflow-hidden bg-background">
      <div className="m-10 h-[200px] w-[200px] shrink-0 overflow-hidden rounded-full text-5xl">
        <Picture group={room.isGroup} picture={room.isGroup ? room.picture : other.picture} user={other} />
      </div>
      <Button variant="secondary" className="w-full" onClick={() => setViewMembers(!viewMembers)}>
        {`View ${viewMembers ? 'Images' : 'Members'}`}
      </Button>
      {viewMembers && <div className="h-full w-full overflow-y-auto py-0 pr-5">{members}</div>}
      <div
        className="flex w-full flex-1 flex-col overflow-y-auto overflow-x-hidden py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={scrollContainer}
        onScroll={onScroll}
        hidden={viewMembers}
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
        <Notice />
      </div>
    </div>
  );
}

export default Room;
