import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isToolLoopV2Enabled } from '../../../src/prompt/feature-flags.js';

describe('feature-flags', () => {
  describe('isToolLoopV2Enabled', () => {
    const originalEnv = process.env.TOOL_LOOP_V2_ENABLED;

    beforeEach(() => {
      delete process.env.TOOL_LOOP_V2_ENABLED;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.TOOL_LOOP_V2_ENABLED;
      } else {
        process.env.TOOL_LOOP_V2_ENABLED = originalEnv;
      }
    });

    it('returns false when TOOL_LOOP_V2_ENABLED is not set', () => {
      expect(isToolLoopV2Enabled()).toBe(false);
    });

    it('returns true when TOOL_LOOP_V2_ENABLED is set to "true"', () => {
      process.env.TOOL_LOOP_V2_ENABLED = 'true';
      expect(isToolLoopV2Enabled()).toBe(true);
    });
  });
});
