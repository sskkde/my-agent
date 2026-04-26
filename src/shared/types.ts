export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

export type RetentionPolicy = 'ephemeral' | 'short' | 'standard' | 'long' | 'permanent';

export type StatusCategory =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting'
  | 'skipped';

export interface TimestampFields {
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BaseEntity extends TimestampFields {
  id: string;
  sensitivity: SensitivityLevel;
  retention: RetentionPolicy;
}

export interface StatusEntity extends BaseEntity {
  status: StatusCategory;
  statusMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}
