import type { ConnectionManager } from './connection.js'

export interface Organization {
  orgId: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
}

export interface UserOrganization {
  userId: string
  orgId: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
}

export interface OrganizationStore {
  create(input: { orgId: string; name: string; slug: string }): Organization
  getById(orgId: string): Organization | null
  getBySlug(slug: string): Organization | null
  getDefault(): Organization
  update(orgId: string, input: { name?: string; slug?: string }): boolean
  delete(orgId: string): boolean
  list(): Organization[]

  addUser(userId: string, orgId: string, role?: 'owner' | 'admin' | 'member'): UserOrganization
  removeUser(userId: string, orgId: string): boolean
  getUserOrganizations(userId: string): Organization[]
  getOrganizationUsers(orgId: string): UserOrganization[]
  updateUserRole(userId: string, orgId: string, role: 'owner' | 'admin' | 'member'): boolean
}

interface OrganizationRow {
  org_id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

interface UserOrganizationRow {
  user_id: string
  org_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
}

class OrganizationStoreImpl implements OrganizationStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(input: { orgId: string; name: string; slug: string }): Organization {
    const now = new Date().toISOString()
    const sql = `
      INSERT INTO organizations (org_id, name, slug, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
    this.connection.exec(sql, [input.orgId, input.name, input.slug, now, now])
    return {
      orgId: input.orgId,
      name: input.name,
      slug: input.slug,
      createdAt: now,
      updatedAt: now,
    }
  }

  getById(orgId: string): Organization | null {
    const rows = this.connection.query<OrganizationRow>('SELECT * FROM organizations WHERE org_id = ?', [orgId])
    return rows.length > 0 ? this.rowToOrganization(rows[0]) : null
  }

  getBySlug(slug: string): Organization | null {
    const rows = this.connection.query<OrganizationRow>('SELECT * FROM organizations WHERE slug = ?', [slug])
    return rows.length > 0 ? this.rowToOrganization(rows[0]) : null
  }

  getDefault(): Organization {
    const org = this.getById('org_default')
    if (!org) {
      throw new Error('Default organization not found')
    }
    return org
  }

  update(orgId: string, input: { name?: string; slug?: string }): boolean {
    const updates: string[] = []
    const params: unknown[] = []
    const now = new Date().toISOString()

    if (input.name !== undefined) {
      updates.push('name = ?')
      params.push(input.name)
    }
    if (input.slug !== undefined) {
      updates.push('slug = ?')
      params.push(input.slug)
    }
    if (updates.length === 0) {
      return false
    }

    updates.push('updated_at = ?')
    params.push(now)
    params.push(orgId)

    try {
      this.connection.exec(`UPDATE organizations SET ${updates.join(', ')} WHERE org_id = ?`, params)
      return true
    } catch {
      return false
    }
  }

  delete(orgId: string): boolean {
    try {
      this.connection.exec('DELETE FROM organizations WHERE org_id = ?', [orgId])
      return true
    } catch {
      return false
    }
  }

  list(): Organization[] {
    const rows = this.connection.query<OrganizationRow>('SELECT * FROM organizations ORDER BY created_at ASC')
    return rows.map((row) => this.rowToOrganization(row))
  }

  addUser(userId: string, orgId: string, role: 'owner' | 'admin' | 'member' = 'member'): UserOrganization {
    const now = new Date().toISOString()
    const sql = `
      INSERT INTO user_organizations (user_id, org_id, role, joined_at)
      VALUES (?, ?, ?, ?)
    `
    this.connection.exec(sql, [userId, orgId, role, now])
    return { userId, orgId, role, joinedAt: now }
  }

  removeUser(userId: string, orgId: string): boolean {
    try {
      this.connection.exec('DELETE FROM user_organizations WHERE user_id = ? AND org_id = ?', [userId, orgId])
      return true
    } catch {
      return false
    }
  }

  getUserOrganizations(userId: string): Organization[] {
    const rows = this.connection.query<OrganizationRow>(
      `SELECT o.* FROM organizations o
       INNER JOIN user_organizations uo ON o.org_id = uo.org_id
       WHERE uo.user_id = ?
       ORDER BY o.created_at ASC`,
      [userId],
    )
    return rows.map((row) => this.rowToOrganization(row))
  }

  getOrganizationUsers(orgId: string): UserOrganization[] {
    const rows = this.connection.query<UserOrganizationRow>(
      'SELECT * FROM user_organizations WHERE org_id = ? ORDER BY joined_at ASC',
      [orgId],
    )
    return rows.map((row) => this.rowToUserOrganization(row))
  }

  updateUserRole(userId: string, orgId: string, role: 'owner' | 'admin' | 'member'): boolean {
    const now = new Date().toISOString()
    try {
      this.connection.exec('UPDATE user_organizations SET role = ?, joined_at = ? WHERE user_id = ? AND org_id = ?', [
        role,
        now,
        userId,
        orgId,
      ])
      const rows = this.connection.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM user_organizations WHERE user_id = ? AND org_id = ? AND role = ?',
        [userId, orgId, role],
      )
      return rows[0]?.count === 1
    } catch {
      return false
    }
  }

  private rowToOrganization(row: OrganizationRow): Organization {
    return {
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private rowToUserOrganization(row: UserOrganizationRow): UserOrganization {
    return {
      userId: row.user_id,
      orgId: row.org_id,
      role: row.role,
      joinedAt: row.joined_at,
    }
  }
}

export function createOrganizationStore(connection: ConnectionManager): OrganizationStore {
  return new OrganizationStoreImpl(connection)
}
