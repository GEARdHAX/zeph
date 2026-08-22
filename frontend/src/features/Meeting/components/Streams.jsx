import { useSelector } from 'react-redux';
import { useGlobal } from 'reactn';
import Interface from './Interface';

function Streams({
  streams = [], children, isMaximized, isGrid,
}) {
  const consumers = useSelector((state) => state.rtc.consumers) || [];
  const producers = useSelector((state) => state.rtc.producers) || [];
  const peers = useSelector((state) => state.rtc.peers) || {};
  const socketID = useSelector((state) => state.io.id);
  const [mainStream, setMainStream] = useGlobal('mainStream');

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
    const isScreen = (actualPeer.video || actualPeer.screen)
      && producers.filter((p) => p.producerID === actualPeer.video?.producerID && p.isScreen).length > 0;
    actualPeers.push({ ...actualPeer, isScreen });
  });

  const counterpart = useSelector((state) => state.rtc.counterpart);

  if (actualPeers.length === 0 && counterpart) {
    const fallbackPeer = {
      user: counterpart,
      video: streams.find((s) => s.isVideo) || null,
      audio: streams.find((s) => !s.isVideo) || null,
      isScreen: false,
    };
    return (
      <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background p-3 sm:p-4">
        <div className="absolute inset-0 bg-radial from-primary/5 via-transparent to-black/80 pointer-events-none" />
        <div className="relative z-10 flex h-full w-full flex-1 flex-col">
          <div className="relative flex flex-1 flex-row">
            <div className="relative flex-1">
              <Interface
                isMaximized={isMaximized}
                video={fallbackPeer.video}
                audio={fallbackPeer.audio}
                peer={fallbackPeer.user}
                isScreen={fallbackPeer.isScreen}
              />
            </div>
          </div>
        </div>
        {children}
      </div>
    );
  }

  if (!isGrid && !mainStream && actualPeers.length > 0) {
    setMainStream(actualPeers[actualPeers.length - 1]);
  }

  if (!isGrid && mainStream && actualPeers.length > 0) {
    let mainPeer = mainStream;
    actualPeers.forEach((peer) => peer.socketID === mainPeer && (mainPeer = peer));
    return (
      <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background p-3 sm:p-4">
        <div className="absolute inset-0 bg-radial from-primary/5 via-transparent to-black/80 pointer-events-none" />
        <div className="relative z-10 flex h-full w-full flex-1 flex-col">
          <div className="relative flex flex-1 flex-row">
            <div className="relative flex-1">
              <Interface
                isMaximized={isMaximized}
                video={mainPeer.video}
                audio={mainPeer.audio}
                peer={mainPeer.user}
                isScreen={mainPeer.isScreen}
              />
            </div>
          </div>
        </div>
        {children}
      </div>
    );
  }

  const side = Math.max(1, Math.ceil(Math.sqrt(actualPeers.length)));

  const rows = [];
  let row = [];

  actualPeers.forEach((peer, key) => {
    if (row.length === side) {
      rows.push(
        // eslint-disable-next-line react/no-array-index-key
        <div className="flex flex-1 flex-row gap-3 sm:gap-4" key={key}>
          {row}
        </div>,
      );
      row = [];
    }
    row.push(
      // eslint-disable-next-line react/no-array-index-key
      <div className="relative flex-1" key={key}>
        <Interface
          isMaximized={isMaximized}
          video={peer.video}
          audio={peer.audio}
          peer={peer.user}
          isScreen={peer.isScreen}
        />
      </div>,
    );
  });

  if (row.length > 0) {
    rows.push(
      <div className="flex flex-1 flex-row gap-3 sm:gap-4" key="last">
        {row}
      </div>,
    );
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background p-3 sm:p-4">
      <div className="absolute inset-0 bg-radial from-primary/5 via-transparent to-black/80 pointer-events-none" />

      {actualPeers.length === 0 && (
        <div className="relative z-10 flex flex-col items-center gap-3 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-base font-bold text-foreground sm:text-lg">Waiting for others to join...</p>
          <p className="text-xs text-muted-foreground">The call will start once the other person joins</p>
        </div>
      )}
      {actualPeers.length > 0 && (
        <div className="relative z-10 flex h-full w-full flex-col gap-3 sm:gap-4">{rows}</div>
      )}
      {children}
    </div>
  );
}

export default Streams;
