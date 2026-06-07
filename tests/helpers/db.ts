import Database from 'better-sqlite3'

export interface TestDatabase {
  isOpen(): boolean
  getPath(): string
  exec(sql: string, params?: unknown[]): void
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  close(): void
}

class TestDatabaseImpl implements TestDatabase {
  private db: Database.Database
  private path: string

  constructor(path: string = ':memory:') {
    this.path = path
    this.db = new Database(path)
  }

  isOpen(): boolean {
    return this.db.open
  }

  getPath(): string {
    return this.path
  }

  exec(sql: string, params?: unknown[]): void {
    const stmt = this.db.prepare(sql)
    if (params && params.length > 0) {
      stmt.run(...params)
    } else {
      stmt.run()
    }
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql)
    if (params && params.length > 0) {
      return stmt.all(...params) as T[]
    }
    return stmt.all() as T[]
  }

  close(): void {
    this.db.close()
  }
}

export function createTestDatabase(path?: string): TestDatabase {
  return new TestDatabaseImpl(path)
}
