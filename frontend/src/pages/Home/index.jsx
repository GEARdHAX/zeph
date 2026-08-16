import { useEffect } from 'react';
import { useGlobal, setGlobal } from 'reactn';
import Div100vh from 'react-div-100vh';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { cn } from '@/lib/utils';
import CreateGroup from '../../features/Group/Create';
import CreateGroup2 from '../../features/Group/Create2';
import Panel from '../../features/Panel';
import Details from '../../features/Details';
import Conversation from '../../features/Conversation';
import Meeting from '../../features/Meeting';
import Welcome from '../../features/Welcome';
import NotFound from '../../features/NotFound';
import Admin from '../../features/Admin';

function Home() {
  const location = useLocation();

  const [over, setOver] = useGlobal('over');
  const showPanel = useGlobal('showPanel')[0];
  const showDetails = useGlobal('showDetails')[0];
  const panel = useGlobal('panel')[0];
  const callIncrement = useSelector((state) => state.rtc.callIncrement);
  const callData = useSelector((state) => state.rtc.callData);

  const navigate = useNavigate();

  useEffect(() => {
    if (!callData) return;
    setGlobal({
      audio: true,
      video: false,
      callDirection: 'incoming',
      meeting: { _id: callData.meetingID },
    }).then(() => {
      navigate(`/meeting/${callData.meetingID}`, { replace: true });
    });
  }, [callIncrement, callData]);

  useEffect(() => {
    if (location.pathname !== '/') setOver(true);
  }, [location]);

  const getPanel = () => {
    switch (panel) {
      case 'createGroup':
        return <CreateGroup />;
      case 'createGroup2':
        return <CreateGroup2 />;
      default:
        return <Panel />;
    }
  };

  return (
    <Div100vh>
      <div className="flex h-full w-full">
        {showPanel && getPanel()}
        <div
          className={cn(
            'flex flex-1 flex-col bg-muted max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:hidden max-sm:h-full max-sm:w-full',
            over && 'max-sm:flex max-sm:animate-[slide-in_0.2s_linear]',
            over === false && 'max-sm:left-full max-sm:flex max-sm:animate-[slide-out_0.2s_linear]',
          )}
        >
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/meeting/:id" element={<Meeting />} />
            <Route path="/room/:id" element={<Conversation />} />
            <Route path="/room/:id/info" element={<Details />} />
            <Route path="/*" element={<NotFound />} />
          </Routes>
        </div>
        {!location.pathname.endsWith('/info') && (showDetails || !location.pathname.startsWith('/meeting')) && (
          <Details />
        )}
      </div>
    </Div100vh>
  );
}

export default Home;
