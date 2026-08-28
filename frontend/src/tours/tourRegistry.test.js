import { describe, it, expect } from 'vitest';
import {
  KNOWN_TOUR_IDS, isKnownTour, loadTourDefinition,
} from './tourRegistry';

describe('tourRegistry', () => {
  it('knows about every documented tour id', () => {
    expect(KNOWN_TOUR_IDS).toEqual(expect.arrayContaining([
      'onboarding', 'home', 'chat', 'groups', 'meetings', 'calls', 'media', 'notifications', 'settings', 'admin',
    ]));
  });

  it('isKnownTour is true for a registered id, false for a made-up one', () => {
    expect(isKnownTour('chat')).toBe(true);
    expect(isKnownTour('not-a-real-tour')).toBe(false);
  });

  it('throws a clear error for an unregistered tour id', async () => {
    await expect(loadTourDefinition('not-a-real-tour')).rejects.toThrow(/Unknown tour id/);
  });

  it('loads a real tour definition with the required shape', async () => {
    const definition = await loadTourDefinition('chat');
    expect(definition.id).toBe('chat');
    expect(typeof definition.version).toBe('number');
    expect(typeof definition.title).toBe('string');
    expect(Array.isArray(definition.steps)).toBe(true);
    expect(definition.steps.length).toBeGreaterThan(0);
  });

  it('passes ctx through to the tour builder — RBAC-aware groups tour changes its steps by role', async () => {
    const asMember = await loadTourDefinition('groups', { myRole: 'MEMBER' });
    const asOwner = await loadTourDefinition('groups', { myRole: 'OWNER' });

    const memberHasManageStep = asMember.steps.some((s) => s.element === '[data-tour="group-manage-button"]');
    const ownerHasManageStep = asOwner.steps.some((s) => s.element === '[data-tour="group-manage-button"]');

    expect(memberHasManageStep).toBe(false);
    expect(ownerHasManageStep).toBe(true);
  });

  it('every registered tour loads without throwing and returns a valid definition', async () => {
    // eslint-disable-next-line no-restricted-syntax
    for (const tourId of KNOWN_TOUR_IDS) {
      // eslint-disable-next-line no-await-in-loop
      const definition = await loadTourDefinition(tourId);
      expect(definition.id).toBe(tourId);
      expect(definition.steps.length).toBeGreaterThan(0);
    }
  });
});
