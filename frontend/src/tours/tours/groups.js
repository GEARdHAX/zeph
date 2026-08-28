// The RBAC-aware groups tour — spec §9. Step content is generated FROM the
// caller's actual role (ctx.myRole, the same 'OWNER'|'ADMIN'|'MEMBER'
// string Details/components/Room.jsx already gets from getGroup()'s
// myRole field — see groupPolicy.js on the backend for where that comes
// from). This is UI-only: the tour merely explains what's already visible
// given the current role (canManageGroup/canLeaveGroup in Room.jsx already
// hide OWNER/ADMIN-only buttons from a plain MEMBER) — it never claims a
// user can do something the backend wouldn't actually authorize (spec §31).
const roleLabel = (myRole) => {
  if (myRole === 'OWNER') return 'the owner';
  if (myRole === 'ADMIN') return 'an admin';
  return 'a member';
};

export default function buildGroupsTour({ myRole = 'MEMBER' } = {}) {
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';

  const steps = [
    {
      element: '[data-tour="group-header"]',
      popover: {
        title: 'This group',
        description: `You're ${roleLabel(myRole)} here. Your role decides what you can manage below.`,
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="group-member-list"]',
      popover: {
        title: 'Members',
        description: 'Tap anyone to view their profile. Roles (owner, admin) show as a badge next to their name.',
        side: 'left',
      },
    },
    {
      element: '[data-tour="group-invite-button"]',
      popover: {
        title: 'Invite people',
        description: 'Share a link or QR code — anyone in the group can invite new members.',
        side: 'bottom',
      },
    },
  ];

  // Only OWNER/ADMIN ever see "Manage Group" at all (canManageGroup in
  // Room.jsx) — a MEMBER-role tour simply never reaches these steps, which
  // also means it never highlights a control that doesn't exist for them
  // (spec §14 covers the missing-element case regardless, but this avoids
  // even attempting it).
  if (canManage) {
    steps.push(
      {
        element: '[data-tour="group-manage-button"]',
        popover: {
          title: 'Manage Group',
          description: `As ${roleLabel(myRole)}, you can moderate members, review join requests, and adjust group settings here.`,
          side: 'bottom',
        },
      },
    );
  } else {
    steps.push({
      popover: {
        title: 'Group settings',
        description: 'Only the owner and admins can manage members or change group settings — you\'ll see a "Manage Group" button here if you\'re promoted.',
      },
    });
  }

  return {
    id: 'groups',
    version: 1,
    title: 'Groups in Chitcx',
    requiredRoute: '/room/:id/info',
    steps,
  };
}
