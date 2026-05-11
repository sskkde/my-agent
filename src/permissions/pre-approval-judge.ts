import type {
  PreApprovalJudge,
  PreApprovalJudgeAction,
  PreApprovalJudgeResult,
  PreApprovalRecommendation,
} from './types.js';

export interface MockPreApprovalJudgeConfig {
  defaultRecommendation?: PreApprovalRecommendation;
  defaultConfidence?: number;
  overrides?: Map<string, PreApprovalJudgeResult>;
}

export class MockPreApprovalJudge implements PreApprovalJudge {
  private config: MockPreApprovalJudgeConfig;

  constructor(config: MockPreApprovalJudgeConfig = {}) {
    this.config = {
      defaultRecommendation: config.defaultRecommendation ?? 'ask',
      defaultConfidence: config.defaultConfidence ?? 0.5,
      overrides: config.overrides ?? new Map(),
    };
  }

  async evaluate(action: PreApprovalJudgeAction): Promise<PreApprovalJudgeResult> {
    const key = `${action.actionType}:${action.resource ?? '*'}:${action.operationType}`;
    const override = this.config.overrides?.get(key);
    
    if (override) {
      return override;
    }

    return {
      recommended: this.config.defaultRecommendation!,
      confidence: this.config.defaultConfidence!,
      reason: `Default recommendation for ${action.actionType}`,
    };
  }

  setOverride(key: string, result: PreApprovalJudgeResult): void {
    if (!this.config.overrides) {
      this.config.overrides = new Map();
    }
    this.config.overrides.set(key, result);
  }

  clearOverrides(): void {
    this.config.overrides = new Map();
  }
}

export function createMockPreApprovalJudge(
  config?: MockPreApprovalJudgeConfig
): PreApprovalJudge {
  return new MockPreApprovalJudge(config);
}
