import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  getTourState, setTourState, clearTourState, clearAllTourStateForUser, TourStatus,
} from './tourStorage';

beforeEach(() => {
  window.localStorage.clear();
});

describe('tourStorage', () => {
  it('returns null for a tour with no stored state', () => {
    expect(getTourState('user-1', 'chat')).toBeNull();
  });

  it('persists and reads back a tour state', () => {
    setTourState('user-1', 'chat', { status: TourStatus.IN_PROGRESS, currentStep: 2, version: 1 });
    const state = getTourState('user-1', 'chat');
    expect(state).toEqual({ status: TourStatus.IN_PROGRESS, currentStep: 2, version: 1 });
  });

  it('merges patches rather than overwriting the whole record', () => {
    setTourState('user-1', 'chat', { status: TourStatus.IN_PROGRESS, currentStep: 1 });
    setTourState('user-1', 'chat', { currentStep: 2 });
    expect(getTourState('user-1', 'chat')).toEqual({ status: TourStatus.IN_PROGRESS, currentStep: 2 });
  });

  it('scopes state per user — two users never see each other\'s progress', () => {
    setTourState('user-1', 'chat', { status: TourStatus.COMPLETED });
    setTourState('user-2', 'chat', { status: TourStatus.NOT_STARTED });

    expect(getTourState('user-1', 'chat').status).toBe(TourStatus.COMPLETED);
    expect(getTourState('user-2', 'chat').status).toBe(TourStatus.NOT_STARTED);
  });

  it('scopes state per tourId — two tours for the same user are independent', () => {
    setTourState('user-1', 'chat', { status: TourStatus.COMPLETED });
    setTourState('user-1', 'groups', { status: TourStatus.NOT_STARTED });

    expect(getTourState('user-1', 'chat').status).toBe(TourStatus.COMPLETED);
    expect(getTourState('user-1', 'groups').status).toBe(TourStatus.NOT_STARTED);
  });

  it('clearTourState removes only the targeted record', () => {
    setTourState('user-1', 'chat', { status: TourStatus.COMPLETED });
    setTourState('user-1', 'groups', { status: TourStatus.COMPLETED });

    clearTourState('user-1', 'chat');

    expect(getTourState('user-1', 'chat')).toBeNull();
    expect(getTourState('user-1', 'groups')).not.toBeNull();
  });

  it('clearAllTourStateForUser wipes every tour for that user, leaving other users untouched', () => {
    setTourState('user-1', 'chat', { status: TourStatus.COMPLETED });
    setTourState('user-1', 'groups', { status: TourStatus.COMPLETED });
    setTourState('user-2', 'chat', { status: TourStatus.COMPLETED });

    clearAllTourStateForUser('user-1');

    expect(getTourState('user-1', 'chat')).toBeNull();
    expect(getTourState('user-1', 'groups')).toBeNull();
    expect(getTourState('user-2', 'chat')).not.toBeNull();
  });

  it('never stores anything beyond the documented status/step/version/timestamp shape', () => {
    setTourState('user-1', 'chat', {
      status: TourStatus.COMPLETED, currentStep: 5, version: 1, completedAt: 123456,
    });
    const raw = window.localStorage.getItem('chitcx:tours:user-1:chat');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(['completedAt', 'currentStep', 'status', 'version']);
  });

  it('falls back to an in-memory store without throwing when localStorage.setItem throws (spec: unavailable storage)', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };

    expect(() => setTourState('user-3', 'chat', { status: TourStatus.IN_PROGRESS })).not.toThrow();

    window.localStorage.setItem = original;
  });
});
