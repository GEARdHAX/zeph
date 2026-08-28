// Thin stub — informational-only. Only meaningful for a 'root'-level
// account (see App.jsx's /admin route) — the tour itself doesn't check
// this (the route/nav entry already hides Admin from non-root users), same
// "UI reflects backend authorization, never grants it" posture as
// groups.js (spec §31).
export default function buildAdminTour() {
  return {
    id: 'admin',
    version: 1,
    title: 'Admin console',
    requiredRoute: '/admin',
    steps: [
      {
        popover: {
          title: 'Admin console',
          description: 'User and content management for site administrators.',
        },
      },
    ],
  };
}
