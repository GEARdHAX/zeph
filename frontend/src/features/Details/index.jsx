import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useGlobal } from 'reactn';
import Info from './components/Info';
import Room from './components/Room';
import TopBar from './components/TopBar';

function Details() {
  const location = useLocation();
  const room = useSelector((state) => state.io.room);
  const [showDetails, setShowDetails] = useGlobal('showDetails');

  const navigate = useNavigate();

  const isInfoRoute = location.pathname.endsWith('/info');
  const isRoomRoute = location.pathname.startsWith('/room');

  const closeDetails = () => {
    if (isInfoRoute && room) {
      navigate(`/room/${room._id}`, { replace: true });
    } else {
      setShowDetails(false);
    }
  };

  const getComponent = () => {
    if ((isRoomRoute || isInfoRoute) && room) return <Room />;
    return <Info />;
  };

  return (
    <div className="relative flex h-full w-full flex-col border-l border-border bg-card text-card-foreground">
      {/* Top Header with Back / Close Button */}
      <TopBar back={closeDetails} />

      {/* Main Panel Content */}
      <div className="flex-1 overflow-y-auto">
        {getComponent()}
      </div>
    </div>
  );
}

export default Details;
