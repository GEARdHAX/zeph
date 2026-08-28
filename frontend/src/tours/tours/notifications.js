// Thin stub. IMPORTANT (spec §12): this tour must NEVER call
// Notification.requestPermission() itself — nothing in this codebase does
// that yet (confirmed by audit), and the tour system stays strictly UI-only
// regardless. If/when browser push notifications are added, a dedicated
// user-initiated button should request permission — never a tour step.
export default function buildNotificationsTour() {
  return {
    id: 'notifications',
    version: 1,
    title: 'Notifications',
    requiredRoute: '/notifications',
    steps: [
      {
        element: '[data-tour="notifications-header"]',
        popover: {
          title: 'Notifications',
          description: 'Friend requests and unread conversations land here.',
          side: 'bottom',
        },
      },
    ],
  };
}
