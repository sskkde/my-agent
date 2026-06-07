/**
 * Process Session Store
 *
 * Manages background process sessions with output buffering, timeout handling,
 * and user isolation.
 */

import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { DEFAULT_EXEC_TIMEOUT_MS, DEFAULT_EXEC_OUTPUT_CHARS } from './command-safety.js'

export type ProcessStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'killed'

export interface ProcessSession {
  id: string
  userId: string
  command: string
  workdir: string
  status: ProcessStatus
  startedAt: string
  endedAt?: string
  exitCode?: number | null
  signal?: string | null
  output: string
  outputTruncated: boolean
  timeoutMs: number
  inputBuffer: string[]
  eofSent: boolean
  child: ChildProcess
}

export interface ProcessSessionStoreOptions {
  defaultMaxOutputChars?: number
  defaultTimeoutMs?: number
}

export class ProcessSessionStore {
  private sessions: Map<string, ProcessSession> = new Map()
  private defaultMaxOutputChars: number
  private defaultTimeoutMs: number

  constructor(options?: ProcessSessionStoreOptions) {
    this.defaultMaxOutputChars = options?.defaultMaxOutputChars ?? DEFAULT_EXEC_OUTPUT_CHARS
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS
  }

  private generateSessionId(): string {
    return `proc_${randomBytes(6).toString('hex')}`
  }

  start(params: {
    userId: string
    command: string
    workdir: string
    env: Record<string, string>
    timeoutMs: number
    maxOutputChars: number
  }): string {
    const sessionId = this.generateSessionId()
    const startedAt = new Date().toISOString()
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs
    const maxOutputChars = params.maxOutputChars ?? this.defaultMaxOutputChars

    const child = spawn(params.command, [], {
      shell: true,
      cwd: params.workdir,
      env: { ...process.env, ...params.env },
    })

    const session: ProcessSession = {
      id: sessionId,
      userId: params.userId,
      command: params.command,
      workdir: params.workdir,
      status: 'running',
      startedAt,
      output: '',
      outputTruncated: false,
      timeoutMs,
      inputBuffer: [],
      eofSent: false,
      child,
    }

    this.sessions.set(sessionId, session)

    let outputBuffer = ''
    const appendOutput = (data: Buffer | string) => {
      const chunk = data.toString()
      outputBuffer += chunk

      if (outputBuffer.length > maxOutputChars) {
        outputBuffer = outputBuffer.slice(-maxOutputChars)
        session.outputTruncated = true
      }

      session.output = outputBuffer
    }

    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    const timeoutHandle = setTimeout(() => {
      if (session.status === 'running') {
        child.kill('SIGTERM')

        setTimeout(() => {
          if (session.status === 'running') {
            child.kill('SIGKILL')
          }
        }, 2000)

        session.status = 'timeout'
        session.endedAt = new Date().toISOString()
      }
    }, timeoutMs)

    child.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle)

      if (session.status === 'running') {
        if (signal) {
          session.status = 'killed'
          session.signal = signal
        } else if (code === 0) {
          session.status = 'completed'
        } else {
          session.status = 'failed'
        }
        session.exitCode = code
        session.endedAt = new Date().toISOString()
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeoutHandle)

      if (session.status === 'running') {
        session.status = 'failed'
        session.endedAt = new Date().toISOString()
        session.output += `\nProcess error: ${err.message}`
      }
    })

    return sessionId
  }

  list(userId: string): Array<Omit<ProcessSession, 'child' | 'inputBuffer'>> {
    const result: Array<Omit<ProcessSession, 'child' | 'inputBuffer'>> = []

    for (const session of Array.from(this.sessions.values())) {
      if (session.userId === userId) {
        const { child, inputBuffer, ...rest } = session
        result.push(rest)
      }
    }

    return result
  }

  get(userId: string, sessionId: string): Omit<ProcessSession, 'child' | 'inputBuffer'> | null {
    const session = this.sessions.get(sessionId)

    if (!session || session.userId !== userId) {
      return null
    }

    const { child, inputBuffer, ...rest } = session
    return rest
  }

  appendInput(userId: string, sessionId: string, data: string, eof?: boolean): boolean {
    const session = this.sessions.get(sessionId)

    if (!session || session.userId !== userId || session.status !== 'running') {
      return false
    }

    if (eof) {
      session.eofSent = true
      session.child.stdin?.end(data)
    } else {
      session.child.stdin?.write(data)
    }

    return true
  }

  kill(userId: string, sessionId: string, signal?: string): boolean {
    const session = this.sessions.get(sessionId)

    if (!session || session.userId !== userId || session.status !== 'running') {
      return false
    }

    const killSignal = (signal as NodeJS.Signals) ?? 'SIGTERM'
    session.child.kill(killSignal)
    session.status = 'killed'
    session.signal = killSignal
    session.endedAt = new Date().toISOString()

    return true
  }

  clear(userId: string, sessionId: string): boolean {
    const session = this.sessions.get(sessionId)

    if (!session || session.userId !== userId) {
      return false
    }

    if (session.status === 'running') {
      return false
    }

    return this.sessions.delete(sessionId)
  }

  clearAllNonRunning(): number {
    let count = 0

    for (const [id, session] of Array.from(this.sessions.entries())) {
      if (session.status !== 'running') {
        this.sessions.delete(id)
        count++
      }
    }

    return count
  }
}
