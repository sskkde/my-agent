import Database from 'better-sqlite3'

export interface ConnectionManager {
  open(): void
  close(): void
  isOpen(): boolean
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  exec(sql: string, params?: unknown[]): void
  transaction<T>(fn: () => T): () => T
}

class ConnectionManagerImpl implements ConnectionManager {
  private db: Database.Database | null = null
  private path: string

  constructor(path: string) {
    this.path = path
  }

  open(): void {
    if (this.db) {
      return
    }

    this.db = new Database(this.path)
    const isMemoryDb = this.path === ':memory:'

    // Set busy timeout to 5000ms for concurrent access
    this.db.pragma('busy_timeout = 5000')

    // Set synchronous to NORMAL (1) for durability/performance balance
    this.db.pragma('synchronous = NORMAL')

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON')

    // Optimize for low-resource server (2 cores / 2GB RAM)
    // Memory-mapped I/O disabled for stability
    this.db.pragma('mmap_size = 0')

    // Use memory (2) for temp store (faster for small datasets)
    this.db.pragma('temp_store = MEMORY')

    // Limit worker threads for 2-core system
    this.db.pragma('threads = 2')

    // WAL mode only works with file-based databases, not :memory:
    if (!isMemoryDb) {
      this.db.pragma('journal_mode = WAL')
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  isOpen(): boolean {
    return this.db !== null && this.db.open
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    if (!this.db) {
      throw new Error('Database connection is not open')
    }
    const stmt = this.db.prepare(sql)
    if (params && params.length > 0) {
      return stmt.all(...params) as T[]
    }
    return stmt.all() as T[]
  }

  exec(sql: string, params?: unknown[]): void {
    if (!this.db) {
      throw new Error('Database connection is not open')
    }
    const stmt = this.db.prepare(sql)
    if (params && params.length > 0) {
      stmt.run(...params)
    } else {
      stmt.run()
    }
  }

  transaction<T>(fn: () => T): () => T {
    if (!this.db) {
      throw new Error('Database connection is not open')
    }
    return this.db.transaction(fn)
  }
}

export function createConnectionManager(path: string): ConnectionManager {
  return new ConnectionManagerImpl(path)
}
