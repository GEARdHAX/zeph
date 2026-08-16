import { useState } from 'react';
import { PlusCircle, PhoneCall } from 'lucide-react';
import Picture from '../../../components/Picture';

function User({ user, selected, onSelect }) {
  const setHover = useState(false)[1];

  const title = `${user.firstName} ${user.lastName}`.substr(0, 22);

  return (
    <div
      className="flex h-[54px] cursor-pointer items-center border-b hover:bg-accent"
      onMouseOver={() => setHover(true)}
      onFocus={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onBlur={() => setHover(false)}
      onClick={onSelect}
    >
      <div className="mx-3 h-10 min-w-10 overflow-hidden rounded-full [&_.img]:flex [&_.img]:h-10 [&_.img]:w-10 [&_.img]:items-center [&_.img]:justify-center [&_.img]:bg-secondary [&_.img]:text-lg [&_.img]:text-secondary-foreground">
        <Picture user={user} />
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="text-[13px] font-bold">{`${title}${title.length === 22 ? '...' : ''}`}</div>
      </div>
      <div className="flex items-center pr-1">
        <div className={`pr-2 text-[10px] ${selected ? 'text-blue-700' : 'text-muted-foreground'}`}>
          {`@${user.username}`}
        </div>
      </div>
      <div className="flex items-center pr-1">
        <div className={`flex h-full items-center p-1 ${selected ? 'text-blue-700' : 'text-muted-foreground'}`}>
          {selected ? <PhoneCall className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
        </div>
      </div>
    </div>
  );
}

export default User;
