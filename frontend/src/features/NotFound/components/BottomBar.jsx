import { useGlobal } from 'reactn';
import Config from '../../../config';

function BottomBar() {
  const version = useGlobal('version')[0];

  return (
    <div className="flex h-[54px] w-full items-center justify-between border-t bg-card">
      <div className="m-[7px] ml-3 h-10 w-10 overflow-hidden rounded-full" />
      <div className="flex pr-2">
        <div className="px-2 text-[13px] text-muted-foreground">{`${Config.appName} v${version}`}</div>
      </div>
    </div>
  );
}

export default BottomBar;
