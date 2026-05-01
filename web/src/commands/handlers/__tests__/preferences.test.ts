import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleThink,
  handleVerbose,
  handleReasoning,
  preferenceHandlers,
} from '../preferences.js';

const mockLoadPreferences = vi.fn();
const mockSavePreferences = vi.fn();

vi.mock('../../preferences.js', () => ({
  loadPreferences: () => mockLoadPreferences(),
  savePreferences: (prefs: unknown) => mockSavePreferences(prefs),
  updatePreference: (key: string, value: unknown) => {
    const prefs = mockLoadPreferences();
    prefs[key] = value;
    mockSavePreferences(prefs);
  },
  getDefaultPreferences: () => ({
    verbose: false,
    reasoningVisible: false,
    thinkingLevel: 'off',
  }),
}));

describe('Preference Command Handlers', () => {
  let defaultPrefs: { verbose: boolean; reasoningVisible: boolean; thinkingLevel: string };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultPrefs = {
      verbose: false,
      reasoningVisible: false,
      thinkingLevel: 'off',
    };
    mockLoadPreferences.mockReturnValue({ ...defaultPrefs });
  });

  describe('handleThink', () => {
    it('should display current thinking level with no args', async () => {
      const result = await handleThink([], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Current thinking level: off');
      expect(result.output?.content).toContain('UI preference only');
      expect(result.commandName).toBe('think');
    });

    it('should display current thinking level with status arg', async () => {
      defaultPrefs.thinkingLevel = 'medium';
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleThink(['status'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Current thinking level: medium');
      expect(result.output?.content).toContain('UI preference only');
      expect(result.commandName).toBe('think');
    });

    it('should set thinking level to valid values', async () => {
      const levels = ['off', 'minimal', 'low', 'medium', 'high'];

      for (const level of levels) {
        vi.clearAllMocks();
        mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

        const result = await handleThink([level], {} as never);

        expect(result.success).toBe(true);
        expect(result.output?.content).toContain(`Thinking level set to: ${level}`);
        expect(result.output?.content).toContain('UI preference only');
        expect(mockSavePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ thinkingLevel: level })
        );
      }
    });

    it('should handle case-insensitive values', async () => {
      const result = await handleThink(['MEDIUM'], {} as never);

      expect(result.success).toBe(true);
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: 'medium' })
      );
    });

    it('should reject invalid thinking levels', async () => {
      const result = await handleThink(['invalid'], {} as never);

      expect(result.success).toBe(false);
      expect(result.output?.content).toContain('Invalid thinking level');
      expect(result.output?.content).toContain('off, minimal, low, medium, high');
      expect(mockSavePreferences).not.toHaveBeenCalled();
    });

    it('should not change preferences on invalid input', async () => {
      defaultPrefs.thinkingLevel = 'low';
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleThink(['super-high'], {} as never);

      expect(result.success).toBe(false);
      expect(mockSavePreferences).not.toHaveBeenCalled();
    });
  });

  describe('handleVerbose', () => {
    it('should display current verbose state with no args', async () => {
      const result = await handleVerbose([], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Verbose output: off');
      expect(result.output?.content).toContain('UI preference only');
      expect(result.commandName).toBe('verbose');
    });

    it('should display current verbose state with status arg', async () => {
      defaultPrefs.verbose = true;
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleVerbose(['status'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Verbose output: on');
      expect(result.output?.content).toContain('UI preference only');
      expect(result.commandName).toBe('verbose');
    });

    it('should enable verbose mode with on', async () => {
      const result = await handleVerbose(['on'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Verbose output: on');
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ verbose: true })
      );
    });

    it('should disable verbose mode with off', async () => {
      defaultPrefs.verbose = true;
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleVerbose(['off'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Verbose output: off');
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ verbose: false })
      );
    });

    it('should handle case-insensitive values', async () => {
      const result = await handleVerbose(['ON'], {} as never);

      expect(result.success).toBe(true);
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ verbose: true })
      );
    });

    it('should reject invalid values', async () => {
      const result = await handleVerbose(['maybe'], {} as never);

      expect(result.success).toBe(false);
      expect(result.output?.content).toContain('Invalid value');
      expect(result.output?.content).toContain("'on' or 'off'");
      expect(mockSavePreferences).not.toHaveBeenCalled();
    });

    it('should not change preferences on invalid input', async () => {
      defaultPrefs.verbose = true;
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleVerbose(['yes'], {} as never);

      expect(result.success).toBe(false);
      expect(mockSavePreferences).not.toHaveBeenCalled();
    });
  });

  describe('handleReasoning', () => {
    it('should display current reasoning state with no args', async () => {
      const result = await handleReasoning([], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Reasoning/thinking summary display: off');
      expect(result.output?.content).toContain('UI preference only');
      expect(result.output?.content).toContain('thinking_summary events');
      expect(result.commandName).toBe('reasoning');
    });

    it('should display current reasoning state with status arg', async () => {
      defaultPrefs.reasoningVisible = true;
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleReasoning(['status'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Reasoning/thinking summary display: on');
      expect(result.output?.content).toContain('UI preference only');
      expect(result.commandName).toBe('reasoning');
    });

    it('should enable reasoning display with on', async () => {
      const result = await handleReasoning(['on'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Reasoning/thinking summary display: on');
      expect(result.output?.content).toContain('will now be displayed');
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ reasoningVisible: true })
      );
    });

    it('should disable reasoning display with off', async () => {
      defaultPrefs.reasoningVisible = true;
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleReasoning(['off'], {} as never);

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain('Reasoning/thinking summary display: off');
      expect(result.output?.content).toContain('will be hidden');
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ reasoningVisible: false })
      );
    });

    it('should handle case-insensitive values', async () => {
      const result = await handleReasoning(['OFF'], {} as never);

      expect(result.success).toBe(true);
      expect(mockSavePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ reasoningVisible: false })
      );
    });

    it('should reject invalid values', async () => {
      const result = await handleReasoning(['true'], {} as never);

      expect(result.success).toBe(false);
      expect(result.output?.content).toContain('Invalid value');
      expect(result.output?.content).toContain("'on' or 'off'");
      expect(mockSavePreferences).not.toHaveBeenCalled();
    });

    it('should not change preferences on invalid input', async () => {
      defaultPrefs.reasoningVisible = true;
      mockLoadPreferences.mockReturnValue({ ...defaultPrefs });

      const result = await handleReasoning(['enable'], {} as never);

      expect(result.success).toBe(false);
      expect(mockSavePreferences).not.toHaveBeenCalled();
    });
  });

  describe('preferenceHandlers export', () => {
    it('should export all handlers', () => {
      expect(preferenceHandlers.think).toBe(handleThink);
      expect(preferenceHandlers.verbose).toBe(handleVerbose);
      expect(preferenceHandlers.reasoning).toBe(handleReasoning);
    });
  });
});
