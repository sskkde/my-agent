import type {
  RecoverableRunType,
  RecoveryCheckpointRecord,
  RecoveryCheckpointStore,
  RecoveryManager,
  RecoveryManagerConfig,
  RecoveryResult,
} from './types.js';

class InMemoryRecoveryCheckpointStore implements RecoveryCheckpointStore {
  private readonly checkpoints = new Map<string, RecoveryCheckpointRecord>();

  save(checkpoint: RecoveryCheckpointRecord): void {
    this.checkpoints.set(this.key(checkpoint.runType, checkpoint.runId), checkpoint);
  }

  load(runType: RecoverableRunType, runId: string): RecoveryCheckpointRecord | null {
    return this.checkpoints.get(this.key(runType, runId)) ?? null;
  }

  private key(runType: RecoverableRunType, runId: string): string {
    return `${runType}:${runId}`;
  }
}

class RecoveryManagerImpl implements RecoveryManager {
  private readonly checkpointStore: RecoveryCheckpointStore;
  private readonly eventStore: RecoveryManagerConfig['eventStore'];

  constructor(config: RecoveryManagerConfig) {
    this.checkpointStore = config.checkpointStore ?? new InMemoryRecoveryCheckpointStore();
    this.eventStore = config.eventStore;
  }

  saveCheckpoint(
    runType: RecoverableRunType,
    runId: string,
    data: Record<string, unknown>,
    options: { eventCursor?: string; allowExternalWrites?: boolean } = {}
  ): RecoveryCheckpointRecord {
    const checkpoint: RecoveryCheckpointRecord = {
      runType,
      runId,
      data,
      savedAt: new Date().toISOString(),
      eventCursor: options.eventCursor,
      allowExternalWrites: options.allowExternalWrites ?? false,
    };

    this.checkpointStore.save(checkpoint);
    return checkpoint;
  }

  recoverFromCheckpoint(
    runType: RecoverableRunType,
    runId: string,
    options: { allowExternalWrites?: boolean } = {}
  ): RecoveryResult {
    const checkpoint = this.checkpointStore.load(runType, runId);
    if (!checkpoint) {
      return {
        canRecover: false,
        checkpoint: null,
        events: [],
        blockedReason: 'checkpoint_not_found',
      };
    }

    if (checkpoint.allowExternalWrites && options.allowExternalWrites !== true) {
      return {
        canRecover: false,
        checkpoint,
        events: [],
        blockedReason: 'external_write_replay_requires_explicit_allow',
      };
    }

    const events = this.eventStore
      .findByCorrelationId(runId)
      .filter(event => !checkpoint.eventCursor || event.createdAt >= checkpoint.eventCursor);

    return {
      canRecover: true,
      checkpoint,
      events,
    };
  }
}

export function createRecoveryManager(config: RecoveryManagerConfig): RecoveryManager {
  return new RecoveryManagerImpl(config);
}
