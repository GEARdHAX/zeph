import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useGlobal } from 'reactn';
import { cn } from '@/lib/utils';
import Interface from './Interface';
import LittleInterface from './LittleInterface';

// Spotlight view (isGrid === false): one large focused tile plus a
// thumbnail strip to switch focus — previously the thumbnail strip only
// existed inside <TopBar>'s <LittleStreams>, a header component that's
// hidden/shown by an unrelated toggle and wasn't part of this layout at
// all, so spotlight mode showed one tile with no visible way to change who
// was spotlighted. Built as its own component (not inlined in Streams) so
// the auto-select/reselect effect below has a clean dependency list.
function SpotlightView({ mainPeer, actualPeers, mainStream, setMainStream, isMaximized, children }) {
  useEffect(() => {
    // Nothing spotlighted yet, or the previously-spotlighted peer just left
    // (mainStream still references a socketID no longer in actualPeers) —
    // fall back to the most recently joined peer instead of silently
    // rendering a blank/placeholder tile. A real state update, in an
    // effect, not during render (the previous code called setMainStream
    // directly in the render body, a React anti-pattern that raced with
    // LittleStreams's own click-driven setMainStream call).
    const stillPresent = mainStream && actualPeers.some((peer) => peer.socketID === mainStream.socketID);
    if (!stillPresent && actualPeers.length > 0) {
      setMainStream(actualPeers[actualPeers.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainStream?.socketID, actualPeers.map((p) => p.socketID).join(',')]);

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background p-3 sm:p-4">
      <div className="absolute inset-0 bg-radial from-primary/5 via-transparent to-black/80 pointer-events-none" />
      <div className="relative z-10 flex h-full w-full flex-1 flex-col gap-2 sm:gap-3">
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
        {actualPeers.length > 1 && (
          <div className="flex w-full shrink-0 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {actualPeers.map((peer) => (
              <button
                type="button"
                key={peer.socketID}
                className={cn(
                  'h-[72px] w-[104px] shrink-0 cursor-pointer rounded-xl transition-all',
                  peer.socketID === mainPeer.socketID
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'opacity-80 hover:opacity-100',
                )}
                onClick={() => setMainStream(peer)}
                title={peer.user?.firstName ? `Focus on ${peer.user.firstName}` : 'Focus on this participant'}
              >
                <LittleInterface isMaximized video={peer.video} audio={peer.audio} peer={peer.user} />
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Streams({ streams = [], children, isMaximized, isGrid }) {
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
    const isScreen =
      (actualPeer.video || actualPeer.screen) &&
      producers.filter((p) => p.producerID === actualPeer.video?.producerID && p.isScreen).length > 0;
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

  if (!isGrid && actualPeers.length > 0) {
    // mainStream is looked up by socketID every render, from the CURRENT
    // actualPeers list — never the stale object stashed in the global.
    // Previously this compared `peer.socketID === mainPeer` where mainPeer
    // was the whole stashed object (not a string), which never matched, so
    // the "spotlighted" tile silently kept rendering whatever video/audio
    // stream references were live at the moment it was first selected,
    // even after the real peer's streams changed or the peer left.
    const spotlightedID = mainStream?.socketID;
    const mainPeer = actualPeers.find((peer) => peer.socketID === spotlightedID) || actualPeers[actualPeers.length - 1];

    return (
      <SpotlightView
        mainPeer={mainPeer}
        actualPeers={actualPeers}
        mainStream={mainStream}
        setMainStream={setMainStream}
        isMaximized={isMaximized}
      >
        {children}
      </SpotlightView>
    );
  }

  // CSS grid with a fixed column count, not manually chunked flex rows —
  // the old approach stretched a short LAST row's tiles to fill the full
  // row width (each tile flex-1 within just that row), so e.g. 3 peers at
  // side=2 rendered two half-width tiles on row 1 and one full-width tile
  // on row 2, visibly inconsistent sizing. A grid keeps every tile the
  // same size regardless of how many land in the final row.
  const side = Math.max(1, Math.ceil(Math.sqrt(actualPeers.length)));

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
        <div
          className="relative z-10 grid h-full w-full gap-3 sm:gap-4"
          style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))` }}
        >
          {actualPeers.map((peer) => (
            <div className="relative" key={peer.socketID}>
              <Interface
                isMaximized={isMaximized}
                video={peer.video}
                audio={peer.audio}
                peer={peer.user}
                isScreen={peer.isScreen}
              />
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

export default Streams;
