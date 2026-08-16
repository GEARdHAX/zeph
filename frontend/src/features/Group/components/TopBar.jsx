import { ArrowLeft } from 'lucide-react';
import { useGlobal } from 'reactn';
import { Button } from '@/components/ui/button';
import Picture from '../../../components/Picture';

function TopBar({ back }) {
  const title = useGlobal('groupTitle')[0];
  const room = { title: 'Group', isGroup: true };

  return (
    <div className="flex h-[54px] w-full items-center justify-between border-b bg-card">
      <div className="flex items-center">
        <Button variant="ghost" size="icon" onClick={back}>
          <ArrowLeft />
        </Button>
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full [&_.img]:flex [&_.img]:h-10 [&_.img]:w-10 [&_.img]:items-center [&_.img]:justify-center [&_.img]:rounded-full [&_.img]:bg-secondary [&_.img]:text-lg [&_.img]:text-secondary-foreground">
          <Picture user={room} group={room.isGroup} picture={room.picture} title={room.title} />
        </div>
        <div className="flex flex-col justify-center pl-2">
          <div className="text-[13px] font-bold">Create Group</div>
          <div className="text-[11px] text-muted-foreground">{title || 'Type a group name...'}</div>
        </div>
      </div>
    </div>
  );
}

export default TopBar;
