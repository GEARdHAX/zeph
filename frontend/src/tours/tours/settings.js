// Thin stub — informational-only. Extend with data-tour selectors on
// frontend/src/features/Panel/components/Settings.jsx's sections
// (profile, theme, vault, sessions) when this tour needs real targets.
export default function buildSettingsTour() {
  return {
    id: 'settings',
    version: 1,
    title: 'Your settings',
    requiredRoute: '/settings',
    steps: [
      {
        popover: {
          title: 'Settings',
          description: 'Update your profile, switch themes, manage active sessions, and set up your Private Vault.',
        },
      },
    ],
  };
}
