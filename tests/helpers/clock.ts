export class TestClock {
  private currentTime: number;

  constructor(initialTime: string | number = '2024-01-01T00:00:00.000Z') {
    if (typeof initialTime === 'string') {
      this.currentTime = new Date(initialTime).getTime();
    } else {
      this.currentTime = initialTime;
    }
  }

  now(): number {
    return this.currentTime;
  }

  nowISO(): string {
    return new Date(this.currentTime).toISOString();
  }

  advance(milliseconds: number): void {
    this.currentTime += milliseconds;
  }

  setTime(time: string | number): void {
    if (typeof time === 'string') {
      this.currentTime = new Date(time).getTime();
    } else {
      this.currentTime = time;
    }
  }
}
