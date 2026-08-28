// Thin stub — informational-only steps. See meetings.js's comment; same
// reasoning applies here (Meeting/components/Interface.jsx's in-call
// controls aren't yet instrumented with data-tour attributes).
export default function buildCallsTour() {
  return {
    id: 'calls',
    version: 1,
    title: 'During a call',
    requiredRoute: '/meeting/:id',
    steps: [
      {
        popover: {
          title: 'In-call controls',
          description: 'Mute your mic, turn your camera on/off, share your screen, or leave the call — all from the control bar.',
        },
      },
      {
        popover: {
          title: 'Participants',
          description: 'See who else is on the call and add more people if you need to.',
        },
      },
    ],
  };
}
