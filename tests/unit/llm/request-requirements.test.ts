import { describe, it, expect } from 'vitest';
import { deriveRequestRequirements, canServeRequest } from '../../../src/llm/routing/request-requirements.js';
import type { LLMRequest, ModelInfo, RequestRequirements } from '../../../src/llm/types.js';

describe('deriveRequestRequirements', () => {
  it('should set requiresTools=true when request has tools', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {},
          },
        },
      ],
    };

    const requirements = deriveRequestRequirements(request);
    expect(requirements.requiresTools).toBe(true);
  });

  it('should set requiresJsonMode=true when responseFormat is json_object', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      responseFormat: { type: 'json_object' },
    };

    const requirements = deriveRequestRequirements(request);
    expect(requirements.requiresJsonMode).toBe(true);
  });

  it('should set all requirements false for basic request without tools/json', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const requirements = deriveRequestRequirements(request);
    expect(requirements.requiresTools).toBe(false);
    expect(requirements.requiresJsonMode).toBe(false);
    expect(requirements.requiresStreaming).toBe(false);
    expect(requirements.requiresVision).toBe(false);
    expect(requirements.requiresAudio).toBe(false);
    expect(requirements.requiresPdf).toBe(false);
    expect(requirements.minOutputTokens).toBeUndefined();
  });

  it('should set minOutputTokens from maxTokens', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 1000,
    };

    const requirements = deriveRequestRequirements(request);
    expect(requirements.minOutputTokens).toBe(1000);
  });

  it('should set requiresTools=false for empty tools array', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [],
    };

    const requirements = deriveRequestRequirements(request);
    expect(requirements.requiresTools).toBe(false);
  });

  it('should set requiresJsonMode=false for text responseFormat', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      responseFormat: { type: 'text' },
    };

    const requirements = deriveRequestRequirements(request);
    expect(requirements.requiresJsonMode).toBe(false);
  });
});

describe('canServeRequest', () => {
  const createModel = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
    providerId: 'test-provider',
    modelId: 'test-model',
    family: 'openai',
    protocol: 'openai_chat',
    capabilities: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      structuredOutput: false,
      reasoning: false,
      vision: false,
      audioInput: false,
      pdfInput: false,
      toolChoice: false,
      parallelToolCalls: false,
      promptCache: false,
    },
    limits: {
      contextTokens: 8192,
      outputTokens: 4096,
    },
    ...overrides,
  });

  it('should return false when tools required but model has functionCalling=false', () => {
    const requirements: RequestRequirements = {
      requiresTools: true,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: false,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return true when tools required and model has functionCalling=true', () => {
    const requirements: RequestRequirements = {
      requiresTools: true,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(true);
  });

  it('should return false when json required but model has jsonMode=false', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: true,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: false,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return false when vision required but model has vision=false', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: true,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return false when model outputTokens < minOutputTokens', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
      minOutputTokens: 10000,
    };

    const model = createModel({
      limits: {
        contextTokens: 8192,
        outputTokens: 4096,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return true for basic request with capable model', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel();

    expect(canServeRequest(requirements, model)).toBe(true);
  });

  it('should return false when streaming required but model has streaming=false', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: true,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: false,
        functionCalling: true,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return false when audio required but model has audioInput=false', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: true,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return false when PDF required but model has pdfInput=false', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: true,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });

  it('should return true when model outputTokens >= minOutputTokens', () => {
    const requirements: RequestRequirements = {
      requiresTools: false,
      requiresJsonMode: false,
      requiresStreaming: false,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
      minOutputTokens: 2000,
    };

    const model = createModel({
      limits: {
        contextTokens: 8192,
        outputTokens: 4096,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(true);
  });

  it('should return true when all requirements match model capabilities', () => {
    const requirements: RequestRequirements = {
      requiresTools: true,
      requiresJsonMode: true,
      requiresStreaming: true,
      requiresVision: true,
      requiresAudio: true,
      requiresPdf: true,
      minOutputTokens: 2000,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: true,
        structuredOutput: false,
        reasoning: false,
        vision: true,
        audioInput: true,
        pdfInput: true,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
      limits: {
        contextTokens: 8192,
        outputTokens: 4096,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(true);
  });

  it('should return false when any single capability is missing', () => {
    const requirements: RequestRequirements = {
      requiresTools: true,
      requiresJsonMode: true,
      requiresStreaming: true,
      requiresVision: false,
      requiresAudio: false,
      requiresPdf: false,
    };

    const model = createModel({
      capabilities: {
        streaming: true,
        functionCalling: true,
        jsonMode: false,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        pdfInput: false,
        toolChoice: false,
        parallelToolCalls: false,
        promptCache: false,
      },
    });

    expect(canServeRequest(requirements, model)).toBe(false);
  });
});
