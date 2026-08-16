import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

function TopBar({ back }) {
  return (
    <div className="flex h-[54px] w-full items-center justify-between border-b bg-card px-2">
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={back}>
        <ArrowLeft />
      </Button>
      <div />
    </div>
  );
}

export default TopBar;
