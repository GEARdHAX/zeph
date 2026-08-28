// The chat tour — spec §8. Only stable data-tour selectors (see BottomBar.jsx,
// TopBar.jsx, Messages.jsx for where each attribute lives) — never
// :nth-child/generated classes/Tailwind combos/DOM-hierarchy assumptions.
// Requires an open conversation (requiredRoute is informational for
// whatever entry point triggers this — a "?" help icon inside the
// Conversation view, most naturally).
export default function buildChatTour() {
  return {
    id: 'chat',
    version: 1,
    title: 'Chatting in Chitcx',
    requiredRoute: '/room/:id',
    steps: [
      {
        element: '[data-tour="conversation-info-button"]',
        popover: {
          title: 'Conversation info',
          description: 'Tap here for shared media, group members, and conversation settings.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="call-buttons"]',
        popover: {
          title: 'Voice & video calls',
          description: 'Start a call right from here — no need to leave the conversation.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="message-area"]',
        popover: {
          title: 'Your conversation',
          description: 'Messages, delivery status, and read receipts show up here as they happen.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="message-input"]',
        popover: {
          title: 'Type a message',
          description: 'Use **bold**, *italic*, and @mentions — they render live as you type.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="emoji-button"]',
        popover: {
          title: 'Emoji',
          description: 'Add some personality to your message.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="attachment-button"]',
        popover: {
          title: 'Share photos & files',
          description: 'Send images, videos, and documents — see the Media tour for the full picture-editing flow.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="send-button"]',
        popover: {
          title: 'Send',
          description: 'Or just press Enter — either works.',
          side: 'top',
          align: 'end',
        },
      },
    ],
  };
}
