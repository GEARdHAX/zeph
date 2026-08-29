// Thin stub — informational-only steps (no element targets yet). Extend
// with real data-tour selectors on the Meeting feature's join/controls UI
// (frontend/src/features/Meeting/components/) when this tour needs to
// point at specific buttons; the architecture (registry/controller/hook)
// doesn't change either way.
export default function buildMeetingsTour() {
  return {
    id: 'meetings',
    version: 1,
    title: 'Meetings in zeph.',
    requiredRoute: '/meetings',
    steps: [
      {
        popover: {
          title: 'Meetings',
          description: 'Start an instant meeting, or join one you\'ve been invited to — video and audio calls, right from your browser.',
        },
      },
      {
        popover: {
          title: 'Camera & microphone',
          description: 'You\'ll be asked to allow camera/mic access only when you actually join or start a call — never automatically.',
        },
      },
    ],
  };
}
