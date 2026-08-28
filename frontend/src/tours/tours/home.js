// Contextual help for the inbox specifically — distinct from onboarding.js
// (the full first-run walkthrough): this is what a "?" help icon on the
// inbox screen opens directly (spec §29 — "contextual help should open
// directly at the relevant step rather than forcing the entire tour"),
// reusing the same real selectors onboarding.js already established.
export default function buildHomeTour() {
  return {
    id: 'home',
    version: 1,
    title: 'Your inbox',
    requiredRoute: '/',
    steps: [
      {
        element: '[data-tour="search-bar"]',
        popover: {
          title: 'Search',
          description: 'Find an existing conversation, or press Enter to search for someone new.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="conversation-list"]',
        popover: {
          title: 'Conversations',
          description: 'Sorted by most recent activity. Unread chats show a dot.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="new-chat-button"]',
        popover: {
          title: 'Start something new',
          description: 'Add a friend or create a group from here.',
          side: 'bottom',
        },
      },
    ],
  };
}
