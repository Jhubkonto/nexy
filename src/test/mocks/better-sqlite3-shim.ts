/**
 * A sql.js-backed drop-in for better-sqlite3, used only in Vitest.
 * The native better-sqlite3 binary is compiled for Electron's Node ABI and
 * cannot be loaded by the system Node.js that runs Vitest.
 *
 * Supported API surface (what database.test.ts and database-migrations.ts use):
 *   new Database(':memory:')
 *   db.pragma(str, { simple?: boolean })
 *   db.exec(sql)
 *   db.prepare(sql).all(...args)
 *   db.prepare(sql).get(...args)
 *   db.prepare(sql).run(...args)
 *   db.transaction(fn)()
 *   db.close()
 */

import type { SqlJsStatic } from 'sql.js'
import type { Database as SqlJsDatabase } from 'sql.js'

let _sql: SqlJsStatic | null = null

/** Called by setup-main.ts before any test runs. */
export function setSqlInstance(sql: SqlJsStatic): void {
  _sql = sql
}

function requireSql(): SqlJsStatic {
  if (!_sql) {
    throw new Error(
      '[better-sqlite3-shim] sql.js not initialised. ' +
        'Make sure setup-main.ts is listed in vitest setupFiles.'
    )
  }
  return _sql
}

/** Normalize positional arguments: run(a, b) or run([a, b]) → [a, b] */
function flattenArgs(args: unknown[]): unknown[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0] as unknown[]
  return args
}

class Statement {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string
  ) {}

  run(...args: unknown[]): { changes: number } {
    const params = flattenArgs(args)
    // sql.js db.run() handles a single statement with params
    this.db.run(this.sql, params as any[])
    return { changes: (this.db as any).getRowsModified?.() ?? 0 }
  }

  get(...args: unknown[]): Record<string, unknown> | undefined {
    const params = flattenArgs(args)
    const stmt = this.db.prepare(this.sql)
    if (params.length > 0) stmt.bind(params as any[])
    const row = stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined
    stmt.reset()
    stmt.free()
    return row
  }

  all(...args: unknown[]): Record<string, unknown>[] {
    const params = flattenArgs(args)
    const stmt = this.db.prepare(this.sql)
    if (params.length > 0) stmt.bind(params as any[])
    const rows: Record<string, unknown>[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>)
    }
    stmt.reset()
    stmt.free()
    return rows
  }
}

class Database {
  private readonly db: SqlJsDatabase

  constructor(_filename: string | Buffer) {
    // Always open in-memory; test filenames like ':memory:' are ignored
    this.db = new (requireSql().Database)(Buffer.isBuffer(_filename) ? _filename : undefined)
  }

  serialize(): Buffer { return Buffer.from(this.db.export()) }

  /**
   * Matches better-sqlite3's pragma() behaviour:
   *   db.pragma('foreign_keys = ON')          → run, return undefined
   *   db.pragma('user_version = 5')           → run, return undefined
   *   db.pragma('user_version', { simple })   → read, return scalar or row
   */
  pragma(str: string, opts?: { simple?: boolean }): unknown {
    const trimmed = str.trim()
    if (trimmed.includes('=')) {
      // Setting a pragma
      this.db.run(`PRAGMA ${trimmed}`)
      return undefined
    }
    // Reading a pragma
    const result = this.db.exec(`PRAGMA ${trimmed}`)
    if (!result.length || !result[0].values.length) return opts?.simple ? undefined : []
    const val = result[0].values[0][0]
    if (opts?.simple) return val
    return [{ [trimmed]: val }]
  }

  /** Execute one or more SQL statements (no parameters). */
  exec(sql: string): this {
    this.db.exec(sql)
    return this
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql)
  }

  /**
   * Wraps fn in a BEGIN / COMMIT block; rolls back and rethrows on error.
   * Returns a callable wrapper (matching better-sqlite3 Transaction API).
   */
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.db.run('BEGIN')
      try {
        fn(...args)
        this.db.run('COMMIT')
      } catch (err) {
        this.db.run('ROLLBACK')
        throw err
      }
    }
  }

  close(): void {
    this.db.close()
  }
}

export default Database
export { Database }
