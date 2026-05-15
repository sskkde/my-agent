import type { ConnectionManager } from './connection.js';

export type UserRole = 'admin' | 'user' | 'service';

export interface User {
  userId: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  userId: string;
  username: string;
  passwordHash: string;
  role?: UserRole;
}

export interface UserStore {
  create(input: CreateUserInput): User;
  getById(userId: string): User | null;
  getByUsername(username: string): User | null;
  getFirstCreated(): User | null;
  list(): User[];
  updatePassword(userId: string, passwordHash: string): boolean;
}

interface UserRow {
  user_id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

class UserStoreImpl implements UserStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(input: CreateUserInput): User {
    const isFirstUser = this.getFirstCreated() === null;
    const role = input.role ?? (isFirstUser ? 'admin' : 'user');
    const now = new Date().toISOString();
    const user: User = {
      userId: input.userId,
      username: input.username,
      passwordHash: input.passwordHash,
      role,
      createdAt: now,
      updatedAt: now
    };

    const sql = `
      INSERT INTO users (
        user_id, username, password_hash, role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      user.userId,
      user.username,
      user.passwordHash,
      user.role,
      user.createdAt,
      user.updatedAt
    ];

    this.connection.exec(sql, params);
    return user;
  }

  getById(userId: string): User | null {
    const sql = 'SELECT * FROM users WHERE user_id = ?';
    const rows = this.connection.query<UserRow>(sql, [userId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToUser(rows[0]);
  }

  getByUsername(username: string): User | null {
    const sql = 'SELECT * FROM users WHERE username = ?';
    const rows = this.connection.query<UserRow>(sql, [username]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToUser(rows[0]);
  }

  getFirstCreated(): User | null {
    const sql = 'SELECT * FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1';
    const rows = this.connection.query<UserRow>(sql);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToUser(rows[0]);
  }

  list(): User[] {
    const sql = 'SELECT * FROM users ORDER BY created_at DESC';
    const rows = this.connection.query<UserRow>(sql);
    return rows.map(row => this.rowToUser(row));
  }

  updatePassword(userId: string, passwordHash: string): boolean {
    const sql = `
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE user_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [passwordHash, now, userId]);
      return true;
    } catch {
      return false;
    }
  }

  private rowToUser(row: UserRow): User {
    return {
      userId: row.user_id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export function createUserStore(connection: ConnectionManager): UserStore {
  return new UserStoreImpl(connection);
}
