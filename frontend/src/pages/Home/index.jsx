import { useEffect } from 'react';
import { useGlobal, setGlobal } from 'reactn';
import Div100vh from 'react-div-100vh';
import {
  Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import { useSelector } from 'react-redux';
import { cn } from '@/lib/utils';
import CreateGroup from '../../features/Group/Create';
import CreateGroup2 from '../../features/Group/Create2';
import Panel from '../../features/Panel';
import Settings from '../../features/Panel/components/Settings';
import Details from '../../features/Details';
import Conversation from '../../features/Conversation';
import Meeting from '../../features/Meeting';
import Welcome from '../../features/Welcome';
import NotFound from '../../features/NotFound';
import Admin from '../../features/Admin';
import NavRail from '../../features/Shell/components/NavRail';
import BottomNav from '../../features/Shell/components/BottomNav';
import NotificationsPlaceholder from '../../features/Shell/components/NotificationsPlaceholder';
import useNavSync from '../../features/Shell/useNavSync';

function Home() {
  const location = useLocation();

  const [over, setOver] = useGlobal('over');
  const showPanel = useGlobal('showPanel')[0];
  const showDetails = useGlobal('showDetails')[0];
  const panel = useGlobal('panel')[0];
  const callIncrement = useSelector((state) => state.rtc.callIncrement);
  const callData = useSelector((state) => state.rtc.callData);

  const navigate = useNavigate();

  useNavSync();

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
      <div className="flex h-full w-full flex-col md:flex-row overflow-hidden bg-background text-foreground">
        {/* Desktop / Tablet Navigation Rail (hidden on mobile < md) */}
        <div className="hidden md:flex h-full shrink-0">
          <NavRail />
        </div>

        {/* Sidebar Panel: Chats list, search results, settings, create group */}
        {showPanel && (
          <div
            className={cn(
              'h-full flex-1 md:flex-none',
              location.pathname.startsWith('/room/') || location.pathname.startsWith('/meeting/')
                ? 'hidden md:flex'
                : 'flex',
            )}
          >
            {getPanel()}
          </div>
        )}

        {/* Main Content Area: Conversation, Welcome, Meeting, Admin */}
        <div
          className={cn(
            'flex flex-1 flex-col bg-background overflow-hidden',
            location.pathname === '/' || location.pathname === '/search' || location.pathname === '/favorites' || location.pathname === '/meetings'
              ? 'hidden md:flex'
              : 'flex',
          )}
        >
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/search" element={<Welcome />} />
            <Route path="/favorites" element={<Welcome />} />
            <Route path="/meetings" element={<Welcome />} />
            <Route path="/settings" element={<div className="h-full w-full"><div className="block md:hidden h-full"><Settings /></div><div className="hidden md:block h-full"><Welcome /></div></div>} />
            <Route path="/notifications" element={<NotificationsPlaceholder />} />
            <Route path="/profile" element={<div className="h-full w-full"><div className="block md:hidden h-full"><Settings /></div><div className="hidden md:block h-full"><Welcome /></div></div>} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/meeting/:id" element={<Meeting />} />
            <Route path="/room/:id" element={<Conversation />} />
            <Route path="/room/:id/info" element={<Details />} />
            <Route path="/*" element={<NotFound />} />
          </Routes>
        </div>

        {/* Right-side Details Sidebar (Hidden by default, expands from right on avatar click like WhatsApp) */}
        {!location.pathname.endsWith('/info') && !location.pathname.startsWith('/meeting') && (
          <div
            className={cn(
              'h-full border-l border-border bg-card transition-all duration-300 ease-in-out overflow-hidden z-20',
              showDetails
                ? 'w-full sm:w-[320px] lg:w-[360px] flex shrink-0 shadow-lg'
                : 'w-0 hidden',
            )}
          >
            <Details />
          </div>
        )}

        {/* Mobile Bottom Navigation Bar (visible only on mobile when not inside a chat or call) */}
        {!location.pathname.startsWith('/room/') && !location.pathname.startsWith('/meeting/') && (
          <div className="block md:hidden shrink-0 z-30">
            <BottomNav />
          </div>
        )}
      </div>
    </Div100vh>
  );
}

export default Home;
