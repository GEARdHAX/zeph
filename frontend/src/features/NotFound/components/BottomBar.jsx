import { useGlobal } from 'reactn';
import ZephWordmark from '../../../components/ZephWordmark';

function BottomBar() {
  const version = useGlobal('version')[0];

  return (
    <div className="flex h-[54px] w-full items-center justify-between border-t bg-card">
      <div className="m-[7px] ml-3 h-10 w-10 overflow-hidden rounded-full" />
      <div className="flex items-center gap-1 pr-2 text-[13px] text-muted-foreground">
        <ZephWordmark className="text-[13px] font-semibold" />
        <span>{`v${version}`}</span>
      </div>
    </div>
  );
}

export default BottomBar;
