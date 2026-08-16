import { useGlobal } from 'reactn';
import Picture from '../../components/Picture';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';

function Welcome() {
  const user = useGlobal('user')[0];
  const setOver = useGlobal('over')[1];

  const back = () => setOver(false);

  return (
    <div className="flex h-full flex-col">
      <TopBar back={back} />
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="flex h-[75px] items-end px-4 text-center text-3xl font-bold">{`${user.firstName} ${user.lastName}`}</div>
        <div className="h-[150px] w-[150px] overflow-hidden rounded-full [&_.img]:flex [&_.img]:h-[150px] [&_.img]:w-[150px] [&_.img]:items-center [&_.img]:justify-center [&_.img]:rounded-full [&_.img]:bg-muted-foreground [&_.img]:text-6xl [&_.img]:text-background [&_.picture]:h-[150px] [&_.picture]:w-[150px]">
          <Picture user={user} />
        </div>
        <div className="flex h-[75px] flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Search for someone to start a conversation,
          <br />
          Add contacts to your favorites to reach them faster
        </div>
      </div>
      <BottomBar />
    </div>
  );
}

export default Welcome;
