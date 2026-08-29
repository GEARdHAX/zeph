import { describe, it, expect } from 'vitest';
import Actions from '../constants/Actions';
import reducer from './rtc';

describe('rtc reducer — RTC_PRODUCERS append vs replace', () => {
  it('appends by default (normal join() call sites, unchanged behavior)', () => {
    const state = reducer(undefined, { type: Actions.RTC_PRODUCERS, producers: [{ producerID: 'p1' }] });
    const next = reducer(state, { type: Actions.RTC_PRODUCERS, producers: [{ producerID: 'p2' }] });
    expect(next.producers.map((p) => p.producerID)).toEqual(['p1', 'p2']);
  });

  it('replaces instead of appending when replace:true (callManager.rejoin() after a reconnect)', () => {
    const state = reducer(undefined, { type: Actions.RTC_PRODUCERS, producers: [{ producerID: 'stale-1' }] });
    const next = reducer(state, {
      type: Actions.RTC_PRODUCERS, producers: [{ producerID: 'fresh-1' }], replace: true,
    });
    expect(next.producers.map((p) => p.producerID)).toEqual(['fresh-1']);
  });
});

describe('rtc reducer — RTC_RECONNECTING', () => {
  it('sets reconnecting true/false without touching other state', () => {
    const withProducers = reducer(undefined, { type: Actions.RTC_PRODUCERS, producers: [{ producerID: 'p1' }] });
    const reconnectingState = reducer(withProducers, { type: Actions.RTC_RECONNECTING, reconnecting: true });

    expect(reconnectingState.reconnecting).toBe(true);
    expect(reconnectingState.producers).toHaveLength(1);

    const settledState = reducer(reconnectingState, { type: Actions.RTC_RECONNECTING, reconnecting: false });
    expect(settledState.reconnecting).toBe(false);
  });

  it('defaults to false in initial state', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.reconnecting).toBe(false);
  });

  it('RTC_LEAVE resets reconnecting back to false', () => {
    const reconnectingState = reducer(undefined, { type: Actions.RTC_RECONNECTING, reconnecting: true });
    const leftState = reducer(reconnectingState, { type: Actions.RTC_LEAVE });
    expect(leftState.reconnecting).toBe(false);
  });
});
