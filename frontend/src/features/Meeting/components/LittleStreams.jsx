import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useGlobal } from 'reactn';
import { cn } from '@/lib/utils';
import Interface from './LittleInterface';

function LittleStreams({ streams }) {
  const consumers = useSelector((state) => state.rtc.consumers);
  const peers = useSelector((state) => state.rtc.peers);
  const socketID = useSelector((state) => state.io.id);
  const [mainStream, setMainStream] = useGlobal('mainStream');
  const el = useRef(null);

  useEffect(() => {
    if (!el) return undefined;
    const scrollHorizontally = (e) => {
      const event = window.event || e;
      const delta = Math.max(-1, Math.min(1, event.wheelDelta || -event.detail));
      el.current.scrollLeft -= delta * 40; // Multiplied by 40
      event.preventDefault();
    };
    if (el.current.addEventListener) {
      // IE9, Chrome, Safari, Opera
      el.current.addEventListener('mousewheel', scrollHorizontally, false);
      // Firefox
      el.current.addEventListener('DOMMouseScroll', scrollHorizontally, false);
    }
    return () => {
      if (el.current.addEventListener) {
        // IE9, Chrome, Safari, Opera
        el.current.removeEventListener('mousewheel', scrollHorizontally, false);
        // Firefox
        el.current.removeEventListener('DOMMouseScroll', scrollHorizontally, false);
      }
    };
  }, [el]);

  const actualConsumers = consumers.filter((c) => c !== socketID);
  const actualPeers = [];
  actualConsumers.forEach((consumerID) => {
    const actualPeer = {
      ...peers[consumerID],
      video: null,
      audio: null,
      screen: null,
    };
    const peerStreams = streams.filter((s) => s.socketID === consumerID);
    peerStreams.forEach((stream) => {
      actualPeer.streams = [...(actualPeer.streams || []), stream];
      if (stream.isVideo) return (actualPeer.video = stream);
      actualPeer.audio = stream;
    });
    actualPeers.push(actualPeer);
  });

  const videos = actualPeers.map((peer, key) => (
    <div
      // eslint-disable-next-line react/no-array-index-key
      key={key}
      className={cn(
        'mx-px h-[95px] w-[135px] max-sm:h-[85px] max-sm:w-[110px]',
        mainStream && mainStream.socketID === peer.socketID && 'box-border border-2 border-primary',
      )}
      onClick={() => setMainStream(peer)}
    >
      <Interface isMaximized video={peer.video} audio={peer.audio} peer={peer.user} />
    </div>
  ));

  return (
    <div
      className="flex min-w-[137px] flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      ref={el}
    >
      {actualPeers.length > 0 && videos}
    </div>
  );
}

export default LittleStreams;
