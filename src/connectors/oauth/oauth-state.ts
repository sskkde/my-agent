import { randomUUID, createHash, randomBytes } from 'crypto';
import type { OAuthState } from './oauth-types.js';

export class OAuthStateManager {
  private states: Map<string, OAuthState> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private ttlMs: number = 10 * 60 * 1000) {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  generatePkce(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  createState(params: {
    providerId: string;
    connectorType: string;
    codeVerifier: string;
    redirectUri: string;
    userId: string;
  }): OAuthState {
    const now = new Date();
    const state: OAuthState = {
      stateId: randomUUID(),
      providerId: params.providerId,
      connectorType: params.connectorType,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      used: false,
      userId: params.userId,
    };
    this.states.set(state.stateId, state);
    return state;
  }

  consumeState(stateId: string): OAuthState | null {
    const state = this.states.get(stateId);
    if (!state) return null;
    if (state.used) return null;
    if (new Date(state.expiresAt) < new Date()) {
      this.states.delete(stateId);
      return null;
    }
    state.used = true;
    return state;
  }

  verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
    const computed = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return computed === codeChallenge;
  }

  cleanup(): void {
    const now = new Date();
    for (const [id, state] of this.states) {
      if (new Date(state.expiresAt) < now) {
        this.states.delete(id);
      }
    }
  }

  getActiveCount(): number {
    return this.states.size;
  }
}
