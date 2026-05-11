import type { ConnectionManager } from './connection.js';

export interface ConnectorPolicy {
  policyId: string;
  connectorId: string;
  resourcePattern: string;
  action: string;
  effect: 'allow' | 'deny';
  allowedScopes?: string[] | null;
  riskCap?: string | null;
  auditLabel?: string | null;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectorPolicy {
  policyId: string;
  connectorId: string;
  resourcePattern: string;
  action: string;
  effect: 'allow' | 'deny';
  allowedScopes?: string[];
  riskCap?: string;
  auditLabel?: string;
  userId?: string;
}

export interface UpdateConnectorPolicy {
  resourcePattern?: string;
  action?: string;
  effect?: 'allow' | 'deny';
  allowedScopes?: string[] | null;
  riskCap?: string | null;
  auditLabel?: string | null;
}

export interface ConnectorPolicyStore {
  create(policy: CreateConnectorPolicy): ConnectorPolicy;
  getById(policyId: string): ConnectorPolicy | null;
  listPolicies(): ConnectorPolicy[];
  getPoliciesByConnector(connectorId: string): ConnectorPolicy[];
  getPoliciesByUser(userId: string): ConnectorPolicy[];
  update(policyId: string, updates: UpdateConnectorPolicy): ConnectorPolicy;
  delete(policyId: string): void;
  getEffectivePolicies(
    connectorId: string,
    resource: string,
    action: string,
    userId?: string
  ): ConnectorPolicy[];
}

class ConnectorPolicyStoreImpl implements ConnectorPolicyStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(policy: CreateConnectorPolicy): ConnectorPolicy {
    const now = new Date().toISOString();
    const connectorPolicy: ConnectorPolicy = {
      policyId: policy.policyId,
      connectorId: policy.connectorId,
      resourcePattern: policy.resourcePattern,
      action: policy.action,
      effect: policy.effect,
      allowedScopes: policy.allowedScopes ?? null,
      riskCap: policy.riskCap ?? null,
      auditLabel: policy.auditLabel ?? null,
      userId: policy.userId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.connection.exec(
      `INSERT INTO connector_policies (
        policy_id, connector_id, resource_pattern, action, effect,
        allowed_scopes, risk_cap, audit_label, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        connectorPolicy.policyId,
        connectorPolicy.connectorId,
        connectorPolicy.resourcePattern,
        connectorPolicy.action,
        connectorPolicy.effect,
        connectorPolicy.allowedScopes ? JSON.stringify(connectorPolicy.allowedScopes) : null,
        connectorPolicy.riskCap,
        connectorPolicy.auditLabel,
        connectorPolicy.userId,
        connectorPolicy.createdAt,
      ]
    );

    return connectorPolicy;
  }

  getById(policyId: string): ConnectorPolicy | null {
    const results = this.connection.query<ConnectorPolicyRow>(
      'SELECT * FROM connector_policies WHERE policy_id = ?',
      [policyId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.rowToPolicy(results[0]);
  }

  listPolicies(): ConnectorPolicy[] {
    const results = this.connection.query<ConnectorPolicyRow>(
      'SELECT * FROM connector_policies ORDER BY created_at DESC',
      []
    );
    return results.map(row => this.rowToPolicy(row));
  }

  getPoliciesByConnector(connectorId: string): ConnectorPolicy[] {
    const results = this.connection.query<ConnectorPolicyRow>(
      'SELECT * FROM connector_policies WHERE connector_id = ? ORDER BY created_at DESC',
      [connectorId]
    );
    return results.map(row => this.rowToPolicy(row));
  }

  getPoliciesByUser(userId: string): ConnectorPolicy[] {
    const results = this.connection.query<ConnectorPolicyRow>(
      'SELECT * FROM connector_policies WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return results.map(row => this.rowToPolicy(row));
  }

  update(policyId: string, updates: UpdateConnectorPolicy): ConnectorPolicy {
    const existing = this.getById(policyId);
    if (!existing) {
      throw new Error(`Connector policy not found: ${policyId}`);
    }

    const now = new Date().toISOString();
    const updated: ConnectorPolicy = {
      ...existing,
      resourcePattern: updates.resourcePattern ?? existing.resourcePattern,
      action: updates.action ?? existing.action,
      effect: updates.effect ?? existing.effect,
      allowedScopes: updates.allowedScopes !== undefined ? updates.allowedScopes : existing.allowedScopes,
      riskCap: updates.riskCap !== undefined ? updates.riskCap : existing.riskCap,
      auditLabel: updates.auditLabel !== undefined ? updates.auditLabel : existing.auditLabel,
      updatedAt: now,
    };

    this.connection.exec(
      `UPDATE connector_policies SET
        resource_pattern = ?,
        action = ?,
        effect = ?,
        allowed_scopes = ?,
        risk_cap = ?,
        audit_label = ?,
        updated_at = ?
      WHERE policy_id = ?`,
      [
        updated.resourcePattern,
        updated.action,
        updated.effect,
        updated.allowedScopes ? JSON.stringify(updated.allowedScopes) : null,
        updated.riskCap,
        updated.auditLabel,
        updated.updatedAt,
        policyId,
      ]
    );

    return updated;
  }

  delete(policyId: string): void {
    this.connection.exec('DELETE FROM connector_policies WHERE policy_id = ?', [policyId]);
  }

  /**
   * Get effective policies for a connector/resource/action combination.
   * Returns policies that match:
   * - connectorId exactly
   * - resourcePattern matches resource (glob pattern with *)
   * - action matches exactly or is '*'
   * - userId matches or is null (global policy)
   * 
   * Order: user-specific policies first (regardless of effect), then global policies.
   * Within each group, deny policies take precedence over allow.
   */
  getEffectivePolicies(
    connectorId: string,
    resource: string,
    action: string,
    userId?: string
  ): ConnectorPolicy[] {
    const allPolicies = this.getPoliciesByConnector(connectorId);

    const matchingPolicies = allPolicies.filter(policy => {
      if (policy.action !== action && policy.action !== '*') {
        return false;
      }

      if (!this.matchesPattern(policy.resourcePattern, resource)) {
        return false;
      }

      if (policy.userId !== null && policy.userId !== userId) {
        return false;
      }

      return true;
    });

    return matchingPolicies.sort((a, b) => {
      if (a.userId !== null && b.userId === null) return -1;
      if (a.userId === null && b.userId !== null) return 1;

      if (a.effect === 'deny' && b.effect !== 'deny') return -1;
      if (a.effect !== 'deny' && b.effect === 'deny') return 1;

      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  private matchesPattern(pattern: string, value: string): boolean {
    // Convert glob pattern to regex
    // * matches any sequence of characters (including empty)
    // ? matches single character
    const regexPattern = pattern
      .replace(/[.+^${}|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
      .replace(/\*/g, '.*') // * -> .*
      .replace(/\?/g, '.'); // ? -> .

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }

  private rowToPolicy(row: ConnectorPolicyRow): ConnectorPolicy {
    return {
      policyId: row.policy_id,
      connectorId: row.connector_id,
      resourcePattern: row.resource_pattern,
      action: row.action,
      effect: row.effect as 'allow' | 'deny',
      allowedScopes: row.allowed_scopes ? JSON.parse(row.allowed_scopes) : null,
      riskCap: row.risk_cap,
      auditLabel: row.audit_label,
      userId: row.user_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }
}

interface ConnectorPolicyRow {
  policy_id: string;
  connector_id: string;
  resource_pattern: string;
  action: string;
  effect: string;
  allowed_scopes: string | null;
  risk_cap: string | null;
  audit_label: string | null;
  user_id?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export function createConnectorPolicyStore(connection: ConnectionManager): ConnectorPolicyStore {
  return new ConnectorPolicyStoreImpl(connection);
}
