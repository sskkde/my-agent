import type { ConnectionManager } from './connection.js';
import {
  encryptSecret,
  decryptSecret,
  serializeEncryptedSecret,
  deserializeEncryptedSecret
} from './provider-crypto.js';

export type ProviderType = 'openai' | 'openrouter' | 'ollama' | 'custom';

export interface ProviderConfig {
  providerId: string;
  userId: string;
  providerType: ProviderType;
  displayName: string;
  enabled: boolean;
  baseUrl: string | null;
  selectedModel: string | null;
  source: string;
  lastTestStatus: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConfigWithSecret extends ProviderConfig {
  apiKey: string | null;
}

export interface ProviderConfigSanitized extends ProviderConfig {
  configured: boolean;
  apiKeyLast4: string | null;
}

export interface CreateProviderConfigInput {
  providerId: string;
  userId: string;
  providerType: ProviderType;
  displayName: string;
  enabled?: boolean;
  baseUrl?: string;
  selectedModel?: string;
  apiKey?: string;
}

export interface UpdateProviderConfigInput {
  displayName?: string;
  enabled?: boolean;
  baseUrl?: string;
  selectedModel?: string;
  apiKey?: string;
}

export interface ProviderConfigStore {
  create(input: CreateProviderConfigInput): ProviderConfigSanitized;
  getById(providerId: string): ProviderConfigSanitized | null;
  getByIdWithSecret(providerId: string): ProviderConfigWithSecret | null;
  listByUser(userId: string): ProviderConfigSanitized[];
  update(providerId: string, updates: UpdateProviderConfigInput): boolean;
  remove(providerId: string): boolean;
  updateTestStatus(providerId: string, status: string): boolean;
}

interface ProviderConfigRow {
  provider_id: string;
  user_id: string;
  provider_type: ProviderType;
  display_name: string;
  enabled: number;
  base_url: string | null;
  selected_model: string | null;
  encrypted_api_key: string | null;
  api_key_last4: string | null;
  source: string;
  last_test_status: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

class ProviderConfigStoreImpl implements ProviderConfigStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(input: CreateProviderConfigInput): ProviderConfigSanitized {
    const now = new Date().toISOString();
    let encryptedApiKey: string | null = null;
    let apiKeyLast4: string | null = null;

    if (input.apiKey) {
      const encrypted = encryptSecret(input.apiKey);
      encryptedApiKey = serializeEncryptedSecret(encrypted);
      apiKeyLast4 = input.apiKey.slice(-4);
    }

    const sql = `
      INSERT INTO provider_configs (
        provider_id, user_id, provider_type, display_name, enabled,
        base_url, selected_model, encrypted_api_key, api_key_last4,
        source, last_test_status, last_tested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      input.providerId,
      input.userId,
      input.providerType,
      input.displayName,
      (input.enabled ?? true) ? 1 : 0,
      input.baseUrl ?? null,
      input.selectedModel ?? null,
      encryptedApiKey,
      apiKeyLast4,
      'database',
      null,
      null,
      now,
      now
    ];

    this.connection.exec(sql, params);

    return {
      providerId: input.providerId,
      userId: input.userId,
      providerType: input.providerType,
      displayName: input.displayName,
      enabled: input.enabled ?? true,
      baseUrl: input.baseUrl ?? null,
      selectedModel: input.selectedModel ?? null,
      source: 'database',
      lastTestStatus: null,
      lastTestedAt: null,
      createdAt: now,
      updatedAt: now,
      configured: encryptedApiKey !== null,
      apiKeyLast4
    };
  }

  getById(providerId: string): ProviderConfigSanitized | null {
    const sql = 'SELECT * FROM provider_configs WHERE provider_id = ?';
    const rows = this.connection.query<ProviderConfigRow>(sql, [providerId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToSanitized(rows[0]);
  }

  getByIdWithSecret(providerId: string): ProviderConfigWithSecret | null {
    const sql = 'SELECT * FROM provider_configs WHERE provider_id = ?';
    const rows = this.connection.query<ProviderConfigRow>(sql, [providerId]);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    let apiKey: string | null = null;

    if (row.encrypted_api_key) {
      const encrypted = deserializeEncryptedSecret(row.encrypted_api_key);
      apiKey = decryptSecret(encrypted.encrypted, encrypted.iv, encrypted.authTag);
    }

    return {
      providerId: row.provider_id,
      userId: row.user_id,
      providerType: row.provider_type,
      displayName: row.display_name,
      enabled: Boolean(row.enabled),
      baseUrl: row.base_url,
      selectedModel: row.selected_model,
      source: row.source,
      lastTestStatus: row.last_test_status,
      lastTestedAt: row.last_tested_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      apiKey
    };
  }

  listByUser(userId: string): ProviderConfigSanitized[] {
    const sql = `
      SELECT * FROM provider_configs
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    const rows = this.connection.query<ProviderConfigRow>(sql, [userId]);
    return rows.map(row => this.rowToSanitized(row));
  }

  update(providerId: string, updates: UpdateProviderConfigInput): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.displayName !== undefined) {
      sets.push('display_name = ?');
      params.push(updates.displayName);
    }

    if (updates.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }

    if (updates.baseUrl !== undefined) {
      sets.push('base_url = ?');
      params.push(updates.baseUrl);
    }

    if (updates.selectedModel !== undefined) {
      sets.push('selected_model = ?');
      params.push(updates.selectedModel);
    }

    if (updates.apiKey !== undefined) {
      const encrypted = encryptSecret(updates.apiKey);
      sets.push('encrypted_api_key = ?');
      params.push(serializeEncryptedSecret(encrypted));
      sets.push('api_key_last4 = ?');
      params.push(updates.apiKey.slice(-4));
    }

    if (sets.length === 0) {
      return false;
    }

    sets.push('updated_at = ?');
    const now = new Date().toISOString();
    params.push(now);
    params.push(providerId);

    const sql = `UPDATE provider_configs SET ${sets.join(', ')} WHERE provider_id = ?`;

    try {
      this.connection.exec(sql, params);
      return true;
    } catch {
      return false;
    }
  }

  remove(providerId: string): boolean {
    const sql = 'DELETE FROM provider_configs WHERE provider_id = ?';

    try {
      this.connection.exec(sql, [providerId]);
      return true;
    } catch {
      return false;
    }
  }

  updateTestStatus(providerId: string, status: string): boolean {
    const sql = `
      UPDATE provider_configs
      SET last_test_status = ?, last_tested_at = ?, updated_at = ?
      WHERE provider_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [status, now, now, providerId]);
      return true;
    } catch {
      return false;
    }
  }

  private rowToSanitized(row: ProviderConfigRow): ProviderConfigSanitized {
    return {
      providerId: row.provider_id,
      userId: row.user_id,
      providerType: row.provider_type,
      displayName: row.display_name,
      enabled: Boolean(row.enabled),
      baseUrl: row.base_url,
      selectedModel: row.selected_model,
      source: row.source,
      lastTestStatus: row.last_test_status,
      lastTestedAt: row.last_tested_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      configured: row.encrypted_api_key !== null,
      apiKeyLast4: row.api_key_last4
    };
  }
}

export function createProviderConfigStore(connection: ConnectionManager): ProviderConfigStore {
  return new ProviderConfigStoreImpl(connection);
}
