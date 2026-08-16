import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Info from './components/Info';
import Room from './components/Room';
import TopBar from './components/TopBar';

function Details() {
  const location = useLocation();
  const room = useSelector((state) => state.io.room);

  const navigate = useNavigate();

  const back = () => navigate(`/room/${room._id}`, { replace: true });

  const expand = location.pathname.endsWith('/info');

  const getComponent = () => {
    if (location.pathname.startsWith('/room') && room) return <Room />;
    if (expand && room) return <Room />;
    return <Info />;
  };

  return (
    <div className={expand ? 'h-full w-full border-l' : 'hidden h-full w-[300px] border-l lg:block'}>
      {expand && <TopBar back={back} />}
      {getComponent()}
    </div>
  );
}

export default Details;
