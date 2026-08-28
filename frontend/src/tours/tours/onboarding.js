// Global first-time-user tour — the flow suggested in spec §7. Deliberately
// short (the spec's own suggested 10 steps are trimmed to the elements that
// are actually reliably on screen at once — a real inbox with no
// conversations open yet): navbar, search, conversation list, starting a
// new chat, and where to find help again. Deeper areas (composer,
// attachments, calls) get their own dedicated tours (chat/media/calls) —
// onboarding's job is orientation, not exhaustive coverage.
//
// ctx is unused here (onboarding has no RBAC/role variance) but every tour
// module follows the same (ctx) => definition contract for consistency —
// see tourRegistry.js.
export default function buildOnboardingTour() {
  return {
    id: 'onboarding',
    version: 1,
    title: 'Welcome to Chitcx',
    requiredRoute: '/',
    steps: [
      {
        popover: {
          title: 'Welcome to Chitcx 👋',
          description: "Here's a quick look around. You can skip this anytime, or restart it later from Settings.",
        },
      },
      {
        element: '[data-tour="nav-rail"]',
        popover: {
          title: 'Navigation',
          description: 'Chats, favorites, meetings, and notifications — all one click away.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="search-bar"]',
        popover: {
          title: 'Search',
          description: 'Find a conversation, or start a new one by searching for someone by username.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="conversation-list"]',
        popover: {
          title: 'Your conversations',
          description: 'Every chat and group you\'re part of shows up here, newest activity first.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="new-chat-button"]',
        popover: {
          title: 'Start something new',
          description: 'Create a group, or search above to message someone directly.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: "That's it!",
          description: 'Open any conversation for a closer look at messaging, or revisit this tour anytime from Settings → Help.',
        },
      },
    ],
  };
}
