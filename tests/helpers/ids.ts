export class IdGenerator {
  private counters: Map<string, number> = new Map()

  session(): string {
    return this.generate('sess')
  }

  user(): string {
    return this.generate('user')
  }

  event(): string {
    return this.generate('evt')
  }

  transcript(): string {
    return this.generate('trans')
  }

  plan(): string {
    return this.generate('plan')
  }

  run(): string {
    return this.generate('run')
  }

  toolResult(): string {
    return this.generate('tool_res')
  }

  approval(): string {
    return this.generate('appr')
  }

  backgroundRun(): string {
    return this.generate('bg_run')
  }

  custom(prefix: string): string {
    return this.generate(prefix)
  }

  reset(): void {
    this.counters.clear()
  }

  private generate(prefix: string): string {
    const current = this.counters.get(prefix) || 0
    const next = current + 1
    this.counters.set(prefix, next)
    return `${prefix}_${String(next).padStart(3, '0')}`
  }
}
