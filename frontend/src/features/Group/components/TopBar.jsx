import { ArrowLeft, Users } from 'lucide-react';
import { useGlobal } from 'reactn';
import { Button } from '@/components/ui/button';

function TopBar({ back }) {
  const title = useGlobal('groupTitle')[0];

  return (
    <div className="flex h-16 w-full items-center justify-between border-b border-border/60 bg-card px-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={back}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
          <Users className="h-4 w-4" />
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-xs font-bold text-foreground">Create Group</div>
          <div className="text-[11px] text-muted-foreground truncate max-w-[170px]">
            {title || 'Select participants'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TopBar;
