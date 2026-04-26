interface LLMCall {
  prompt: string;
  timestamp: number;
}

interface PromptRule {
  pattern: string;
  response: string;
}

export class FakeLLMProvider {
  private defaultResponse: string = 'Fake LLM response';
  private responseOverride: string | null = null;
  private calls: LLMCall[] = [];
  private rules: PromptRule[] = [];
  private streamingChunks: string[] = [];
  private shouldThrowError: Error | null = null;

  async complete(prompt: string): Promise<string> {
    if (this.shouldThrowError) {
      throw this.shouldThrowError;
    }

    this.calls.push({
      prompt,
      timestamp: Date.now()
    });

    for (const rule of this.rules) {
      if (prompt.includes(rule.pattern)) {
        return rule.response;
      }
    }

    return this.responseOverride ?? this.defaultResponse;
  }

  async *stream(prompt: string): AsyncGenerator<string> {
    if (this.shouldThrowError) {
      throw this.shouldThrowError;
    }

    this.calls.push({
      prompt,
      timestamp: Date.now()
    });

    for (const chunk of this.streamingChunks) {
      yield chunk;
    }
  }

  setResponse(response: string): void {
    this.responseOverride = response;
  }

  setStreamingChunks(chunks: string[]): void {
    this.streamingChunks = chunks;
  }

  whenPromptContains(pattern: string): { respondWith: (response: string) => void } {
    return {
      respondWith: (response: string) => {
        this.rules.push({ pattern, response });
      }
    };
  }

  setShouldThrow(error: Error): void {
    this.shouldThrowError = error;
  }

  getCallCount(): number {
    return this.calls.length;
  }

  getCalls(): LLMCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls = [];
    this.rules = [];
    this.responseOverride = null;
    this.streamingChunks = [];
    this.shouldThrowError = null;
  }
}
