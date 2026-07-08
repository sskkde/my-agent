export interface SegmentDBudgetConfig {
  totalBudget: number
  subsections: {
    provenance: number
    memoryPolicy: number
    summaryLayers: number
    dynamicFields: number
    runtimeEnvironment: number
    contextItems: number
    userMessage: number
    transcript: number
  }
}

export const DEFAULT_SEGMENT_D_BUDGET: SegmentDBudgetConfig = {
  totalBudget: 4096,
  subsections: {
    provenance: 64,
    memoryPolicy: 256,
    summaryLayers: 512,
    dynamicFields: 128,
    runtimeEnvironment: 128,
    contextItems: 2048,
    userMessage: 0,
    transcript: 768,
  },
}

export interface DroppedContextReason {
  section: string
  reason: string
  itemCount: number
}

const tokenEstimate = (text: string): number => Math.ceil(text.length / 4)

const SUBSECTION_ORDER: Array<{ key: keyof SegmentDBudgetConfig['subsections']; section: string }> = [
  { key: 'provenance', section: 'provenance' },
  { key: 'memoryPolicy', section: 'memoryPolicy' },
  { key: 'summaryLayers', section: 'summaryLayers' },
  { key: 'dynamicFields', section: 'dynamicFields' },
  { key: 'runtimeEnvironment', section: 'runtimeEnvironment' },
  { key: 'contextItems', section: 'contextItems' },
  { key: 'userMessage', section: 'userMessage' },
  { key: 'transcript', section: 'transcript' },
]

const UNLIMITED_SUBSECTIONS: Set<keyof SegmentDBudgetConfig['subsections']> = new Set(['userMessage', 'dynamicFields'])

export function enforceSegmentDBudget(
  parts: string[],
  budget?: SegmentDBudgetConfig,
): { content: string; droppedReasons: DroppedContextReason[] } {
  const droppedReasons: DroppedContextReason[] = []

  if (!budget || parts.length === 0) {
    return { content: parts.join('\n\n'), droppedReasons }
  }

  const trimmed: string[] = []
  for (let i = 0; i < parts.length && i < SUBSECTION_ORDER.length; i++) {
    const subsection = SUBSECTION_ORDER[i]
    const text = parts[i]
    const est = tokenEstimate(text)
    const limit = budget.subsections[subsection.key]

    if (UNLIMITED_SUBSECTIONS.has(subsection.key) || limit === 0) {
      trimmed.push(text)
    } else if (est <= limit) {
      trimmed.push(text)
    } else {
      const ratio = limit / est
      const trimLength = Math.floor(text.length * ratio)
      const trimmedText = text.slice(0, trimLength)
      trimmed.push(trimmedText)
      droppedReasons.push({
        section: subsection.section,
        reason: `estimated ${est} tokens exceeds budget of ${limit} tokens; trimmed from ${text.length} to ${trimmedText.length} chars`,
        itemCount: 1,
      })
    }
  }

  return { content: trimmed.join('\n\n'), droppedReasons }
}
