import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import Interface from './Interface';

const WIDE_QUERY = '(min-width: 640px)';

// True from the `sm` breakpoint up. Layout maths (columns/rows) depends on it, so it has to be
// known in JS and not just in CSS.
const useWide = () => {
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE_QUERY).matches : true));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
};

// Google-Meet-style tiling: 1 fills the stage, 2 sit side by side (stacked on a phone),
// 3-4 make 2 columns, then 3 and 4 columns as the room grows.
export const gridShape = (count, wide) => {
  const n = Math.max(1, count);
  let cols;
  if (!wide) cols = n <= 2 ? 1 : 2;
  else if (n === 1) cols = 1;
  else if (n <= 4) cols = 2;
  else if (n <= 9) cols = 3;
  else cols = 4;
  return { cols, rows: Math.ceil(n / cols) };
};

const fullName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Guest';

// Splits one participant's streams into mic audio, camera and shared screen. A screen share is a
// second video stream from the same person, told apart by the producer's `isScreen` flag.
const classify = (peerStreams, producers) => {
  const out = { audio: null, camera: null, screen: null };
  peerStreams.forEach((stream) => {
    if (!stream.isVideo) out.audio = stream;
    else if (producers.some((p) => p.producerID === stream.producerID && p.isScreen)) out.screen = stream;
    else out.camera = stream;
  });
  return out;
};

// A person always gets a tile (camera or avatar, plus their audio); a screen share adds a second,
// separate tile labelled with the presenter's name.
const buildTiles = (people) => {
  const tiles = [];
  people.forEach((person) => {
    const name = fullName(person.user);
    tiles.push({ id: person.socketID, kind: 'person', user: person.user, video: person.camera, audio: person.audio, name, label: name });
    if (person.screen) {
      tiles.push({ id: `${person.socketID}:screen`, kind: 'screen', user: person.user, video: person.screen, audio: null, name, label: `${name}'s screen` });
    }
  });
  return tiles;
};

function Streams({ streams = [], children, isMaximized, isGrid }) {
  const consumers = useSelector((state) => state.rtc.consumers) || [];
  const producers = useSelector((state) => state.rtc.producers) || [];
  const peers = useSelector((state) => state.rtc.peers) || {};
  const counterpart = useSelector((state) => state.rtc.counterpart);
  const socketID = useSelector((state) => state.io.id);
  const wide = useWide();
  const [pinnedId, setPinnedId] = useState(null);

  let people = consumers
    .filter((c) => c !== socketID)
    .map((consumerID) => ({
      socketID: consumerID,
      user: peers[consumerID]?.user,
      ...classify(
        streams.filter((s) => s.socketID === consumerID),
        producers,
      ),
    }));

  // 1:1 call where the room's consumer list has not arrived yet: show the other person from the
  // streams we already have.
  if (people.length === 0 && counterpart) {
    people = [{ socketID: 'counterpart', user: counterpart, ...classify(streams, producers) }];
  }

  const tiles = buildTiles(people);
  const pinned = tiles.find((t) => t.id === pinnedId);
  const presenting = tiles.find((t) => t.kind === 'screen');
  const lastPerson = [...tiles].reverse().find((t) => t.kind === 'person');
  // Stage = what gets the big area: a pinned tile, else whoever is presenting, else (spotlight
  // layout only) the most recent person. No stage means an even tiled grid.
  const stage = pinned || presenting || (!isGrid ? lastPerson : null);

  const tile = (t, compact = false) => (
    <Interface
      testId={`tile-${t.id}`}
      isMaximized={isMaximized}
      video={t.video}
      audio={t.audio}
      peer={t.user}
      label={t.label}
      isScreen={t.kind === 'screen'}
      compact={compact}
    />
  );

  let body;
  if (tiles.length === 0) {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-base font-bold text-foreground sm:text-lg">Waiting for others to join...</p>
        <p className="text-xs text-muted-foreground">The call will start once the other person joins</p>
      </div>
    );
  } else if (stage) {
    const others = tiles.filter((t) => t.id !== stage.id);
    body = (
      <div className={cn('flex h-full w-full gap-2 sm:gap-3', wide ? 'flex-row' : 'flex-col')}>
        <div className="relative min-h-0 min-w-0 flex-1" data-testid="stage">
          {tile(stage)}
          {pinned && (
            <button
              type="button"
              onClick={() => setPinnedId(null)}
              title="Unpin"
              aria-label="Unpin"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
            >
              <PinOff className="h-4 w-4" />
            </button>
          )}
        </div>
        {others.length > 0 && (
          <div
            className={cn(
              'flex shrink-0 gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              wide ? 'w-52 flex-col overflow-y-auto' : 'h-24 flex-row overflow-x-auto',
            )}
          >
            {others.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setPinnedId(t.id)}
                title={t.kind === 'screen' ? `Focus on ${t.name}'s screen` : `Focus on ${t.name}`}
                className={cn(
                  'group relative shrink-0 cursor-pointer rounded-xl text-left opacity-90 transition hover:opacity-100',
                  wide ? 'h-[117px] w-full' : 'h-full w-36',
                )}
              >
                {tile(t, true)}
                <span className="pointer-events-none absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex">
                  <Pin className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    const { cols, rows } = gridShape(tiles.length, wide);
    const gap = wide ? 12 : 8;
    body = (
      <div className="flex h-full w-full flex-wrap content-center justify-center" style={{ gap }}>
        {tiles.map((t) => (
          <div
            key={t.id}
            className="min-h-0 min-w-0"
            style={{
              width: `calc((100% - ${(cols - 1) * gap}px) / ${cols})`,
              height: `calc((100% - ${(rows - 1) * gap}px) / ${rows})`,
            }}
          >
            {tile(t)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background p-2 sm:p-4">
      <div className="pointer-events-none absolute inset-0 bg-radial from-primary/5 via-transparent to-black/80" />
      {/* Bottom padding keeps tiles clear of the floating control bar. */}
      <div className="relative z-10 h-full w-full pb-[76px] pt-12 sm:pb-24 sm:pt-0">{body}</div>
      {children}
    </div>
  );
}

export default Streams;
