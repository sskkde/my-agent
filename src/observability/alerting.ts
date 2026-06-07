import type { MetricStore } from './types.js'
import type {
  AlertStore,
  AlertRule,
  AlertStateRecord,
  AlertNotification,
  AlertOperator,
  AlertStateValue,
} from '../storage/alert-store.js'
import type { SourceModule } from './types.js'

export interface AlertingEngine {
  evaluateRule(ruleId: string): AlertNotification | null
  evaluateAllRules(): AlertNotification[]
  sendNotification(notification: AlertNotification): Promise<boolean>
}

export interface AlertingEngineOptions {
  alertStore: AlertStore
  metricStore: MetricStore
  onNotification?: (notification: AlertNotification) => void
}

export class AlertingEngineImpl implements AlertingEngine {
  private alertStore: AlertStore
  private metricStore: MetricStore
  private onNotification?: (notification: AlertNotification) => void

  constructor(options: AlertingEngineOptions) {
    this.alertStore = options.alertStore
    this.metricStore = options.metricStore
    this.onNotification = options.onNotification
  }

  evaluateRule(ruleId: string): AlertNotification | null {
    const rule = this.alertStore.getRule(ruleId)
    if (!rule || !rule.enabled) {
      return null
    }

    const now = new Date().toISOString()
    const windowStart = new Date(Date.now() - rule.windowSeconds * 1000).toISOString()

    const currentValue = this.getMetricValue(rule, windowStart, now)
    const shouldFire = this.evaluateCondition(rule, currentValue, windowStart, now)

    const previousState = this.alertStore.getState(ruleId)
    const previousStateValue = previousState?.state ?? 'idle'

    let newState: AlertStateValue
    let firedAt = previousState?.firedAt
    let resolvedAt = previousState?.resolvedAt

    if (shouldFire) {
      if (previousStateValue !== 'firing') {
        newState = 'firing'
        firedAt = now
        resolvedAt = undefined
      } else {
        newState = 'firing'
      }
    } else {
      if (previousStateValue === 'firing') {
        newState = 'resolved'
        resolvedAt = now
      } else {
        newState = 'idle'
      }
    }

    const stateRecord: AlertStateRecord = {
      id: previousState?.id ?? `state-${ruleId}`,
      ruleId,
      state: newState,
      currentValue,
      firedAt,
      resolvedAt,
      labels: { ...rule.labels },
      lastEvaluatedAt: now,
    }

    this.alertStore.updateState(stateRecord)

    if (newState !== previousStateValue) {
      const notification: AlertNotification = {
        rule,
        state: newState,
        previousState: previousStateValue,
        value: currentValue,
        timestamp: now,
        labels: { ...rule.labels },
      }

      if (this.onNotification) {
        this.onNotification(notification)
      }

      return notification
    }

    return null
  }

  evaluateAllRules(): AlertNotification[] {
    const rules = this.alertStore.listRules()
    const notifications: AlertNotification[] = []

    for (const rule of rules) {
      if (rule.enabled) {
        const notification = this.evaluateRule(rule.id)
        if (notification) {
          notifications.push(notification)
        }
      }
    }

    return notifications
  }

  async sendNotification(notification: AlertNotification): Promise<boolean> {
    const { rule } = notification

    if (!rule.webhookUrl) {
      console.log(`[Alerting] Alert ${rule.name} ${notification.state} (no webhook configured)`)
      return true
    }

    try {
      const payload = {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        state: notification.state,
        previousState: notification.previousState,
        value: notification.value,
        threshold: rule.threshold,
        timestamp: notification.timestamp,
        labels: notification.labels,
        firedAt: notification.state === 'firing' ? notification.timestamp : undefined,
        resolvedAt: notification.state === 'resolved' ? notification.timestamp : undefined,
      }

      const response = await fetch(rule.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`[Alerting] Webhook failed for ${rule.name}: ${response.status}`)
        return false
      }

      console.log(`[Alerting] Notification sent for ${rule.name}: ${notification.state}`)
      return true
    } catch (error) {
      console.error(`[Alerting] Failed to send notification for ${rule.name}:`, error)
      return false
    }
  }

  private getMetricValue(rule: AlertRule, windowStart: string, windowEnd: string): number {
    const metrics = this.metricStore.queryMetrics({
      name: rule.metricName,
      module: rule.metricModule as SourceModule | undefined,
      startTime: windowStart,
      endTime: windowEnd,
    })

    if (metrics.length === 0) {
      return 0
    }

    const sum = metrics.reduce((acc, m) => acc + m.value, 0)
    return sum / metrics.length
  }

  private evaluateCondition(rule: AlertRule, currentValue: number, windowStart: string, windowEnd: string): boolean {
    switch (rule.conditionType) {
      case 'threshold':
        return this.evaluateThreshold(rule.operator, currentValue, rule.threshold)

      case 'rate':
        return this.evaluateRate(rule, windowStart, windowEnd)

      case 'absence':
        return this.evaluateAbsence(rule, windowStart, windowEnd)

      default:
        return false
    }
  }

  private evaluateThreshold(operator: AlertOperator | undefined, value: number, threshold: number): boolean {
    if (!operator) {
      return false
    }

    switch (operator) {
      case '>':
        return value > threshold
      case '<':
        return value < threshold
      case '>=':
        return value >= threshold
      case '<=':
        return value <= threshold
      case '==':
        return value === threshold
      default:
        return false
    }
  }

  private evaluateRate(rule: AlertRule, windowStart: string, windowEnd: string): boolean {
    const halfWindow = rule.windowSeconds / 2
    const midPoint = new Date(Date.now() - halfWindow * 1000).toISOString()
    const moduleFilter = rule.metricModule as SourceModule | undefined

    const olderMetrics = this.metricStore.queryMetrics({
      name: rule.metricName,
      module: moduleFilter,
      startTime: windowStart,
      endTime: midPoint,
    })

    const newerMetrics = this.metricStore.queryMetrics({
      name: rule.metricName,
      module: moduleFilter,
      startTime: midPoint,
      endTime: windowEnd,
    })

    const olderSum = olderMetrics.reduce((acc, m) => acc + m.value, 0)
    const newerSum = newerMetrics.reduce((acc, m) => acc + m.value, 0)

    const rate = newerSum - olderSum

    return this.evaluateThreshold(rule.operator, rate, rule.threshold)
  }

  private evaluateAbsence(rule: AlertRule, windowStart: string, windowEnd: string): boolean {
    const metrics = this.metricStore.queryMetrics({
      name: rule.metricName,
      module: rule.metricModule as SourceModule | undefined,
      startTime: windowStart,
      endTime: windowEnd,
    })

    return metrics.length === 0
  }
}

export function createAlertingEngine(options: AlertingEngineOptions): AlertingEngine {
  return new AlertingEngineImpl(options)
}
