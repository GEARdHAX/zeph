// Thin stub, but reuses two REAL selectors already added for the chat tour
// (attachment-button, message-composer) — media sharing starts from the
// same composer, so this tour intentionally overlaps with chat.js's entry
// point rather than duplicating a separate button. No file is actually
// uploaded/sent by the tour itself (spec §11).
export default function buildMediaTour() {
  return {
    id: 'media',
    version: 1,
    title: 'Sharing photos & files',
    requiredRoute: '/room/:id',
    steps: [
      {
        element: '[data-tour="attachment-button"]',
        popover: {
          title: 'Attach & send',
          description: 'Pick an image, video, or document — you\'ll get a preview and editing step before anything sends.',
          side: 'top',
        },
      },
      {
        popover: {
          title: 'Select → Preview/Edit → Send',
          description: 'Crop or trim before sending, and large files are compressed automatically. Nothing uploads until you hit send.',
        },
      },
    ],
  };
}
