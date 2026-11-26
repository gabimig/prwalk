import { describe, expect, it } from 'vitest';
import { idleMsFrom } from './daemon.js';

describe('idleMsFrom', () => {
  it('reads PRWALK_IDLE_MINUTES: 4 hours by default, 0 turns it off, anything else is refused', () => {
    expect(idleMsFrom({})).toBe(4 * 60 * 60 * 1000);
    expect(idleMsFrom({ PRWALK_IDLE_MINUTES: '1.5' })).toBe(90_000);
    expect(idleMsFrom({ PRWALK_IDLE_MINUTES: '0' })).toBeUndefined();
    expect(idleMsFrom({ PRWALK_IDLE_MINUTES: '100000' })).toBe(2 ** 31 - 1);
    expect(() => idleMsFrom({ PRWALK_IDLE_MINUTES: 'soon' })).toThrow(
      'PRWALK_IDLE_MINUTES must be a number of minutes, 0 to never shut down, got "soon".',
    );
    expect(() => idleMsFrom({ PRWALK_IDLE_MINUTES: '-1' })).toThrow('got "-1"');
    expect(() => idleMsFrom({ PRWALK_IDLE_MINUTES: '' })).toThrow('got ""');
  });
});
