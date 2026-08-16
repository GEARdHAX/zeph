import { useGlobal } from 'reactn';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';

function NotFound() {
  const setOver = useGlobal('over')[1];

  const back = () => setOver(false);

  return (
    <div className="flex h-full flex-col">
      <TopBar back={back} />
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <div className="text-6xl font-bold">404</div>
        <div className="text-center text-sm text-muted-foreground">
          This page does not exist.
          <br />
          There is just an empty void here.
        </div>
      </div>
      <BottomBar />
    </div>
  );
}

export default NotFound;
