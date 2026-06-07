import type {
  ContextItem,
  ContextAssemblyInput,
  ContextBundle,
  ContextSelectionReport,
  PipelineContext,
  NormalizedItem,
  ScoredItem,
  RuntimeContextDelta,
} from './types.js'

export class ContextManager {
  private lastReport: ContextSelectionReport | null = null
  private deltaItems: ContextItem[] = []

  assemble(input: ContextAssemblyInput): ContextBundle {
    const pipelineContext = this.initializePipeline(input)

    this.normalizeStage(pipelineContext)
    this.filterStage(pipelineContext)
    this.dedupStage(pipelineContext)
    this.scoreStage(pipelineContext)
    this.selectStage(pipelineContext)

    this.generateReport(pipelineContext)

    return this.buildBundle(pipelineContext)
  }

  getLastReport(): ContextSelectionReport | null {
    return this.lastReport
  }

  getItems(): ContextItem[] {
    return [...this.deltaItems]
  }

  addItem(item: ContextItem): void {
    this.deltaItems.push(item)
  }

  applyDelta(delta: RuntimeContextDelta): void {
    if (delta.replaceKeys && delta.replaceKeys.length > 0) {
      const replaceKeys = new Set(delta.replaceKeys)
      this.deltaItems = this.deltaItems.filter((item) => {
        const key = item.dedupeKey ?? item.supersedesKey ?? item.itemId
        return !replaceKeys.has(key)
      })
    }

    if (delta.items.length > 0) {
      this.deltaItems.push(...delta.items)
    }
  }

  assembleBundle(): ContextBundle {
    return {
      bundleId: this.generateId('bundle'),
      runId: '',
      agentId: '',
      agentType: 'main',
      userId: '',
      invocationSource: 'system',
      pinnedItems: [],
      orderedItems: [...this.deltaItems],
      tokenEstimate: this.deltaItems.reduce(
        (sum, item) => sum + (item.estimatedTokens ?? this.estimateTokens(item.content)),
        0,
      ),
    }
  }

  private initializePipeline(input: ContextAssemblyInput): PipelineContext {
    const items: ContextItem[] = []

    if (input.hydratedState?.conversationHistory) {
      items.push(...input.hydratedState.conversationHistory)
    }

    if (input.hydratedState?.sessionMemory) {
      items.push(input.hydratedState.sessionMemory)
    }

    if (input.conversationState?.recentTurns) {
      items.push(...input.conversationState.recentTurns.map((turn, idx) => this.createTurnItem(turn, idx)))
    }

    if (input.workingContext?.recentToolResults) {
      items.push(...input.workingContext.recentToolResults.map((result, idx) => this.createToolResultItem(result, idx)))
    }

    if (input.workingContext?.recentSubagentResults) {
      items.push(
        ...input.workingContext.recentSubagentResults.map((result, idx) => this.createSubagentResultItem(result, idx)),
      )
    }

    items.push(...this.deltaItems)

    return {
      input,
      items: [...items],
      normalizedItems: [],
      filteredItems: [],
      dedupedItems: [],
      scoredItems: [],
      selectedItems: [],
      pairGroups: new Map(),
      report: {
        bundleId: this.generateId('bundle'),
        runId: input.runId,
        totalItemsConsidered: items.length,
        tokenBudget: input.selectionPolicy.tokenBudget,
        viewType: input.selectionPolicy.targetMode,
        timestamp: new Date().toISOString(),
      },
    }
  }

  private normalizeStage(ctx: PipelineContext): void {
    ctx.normalizedItems = ctx.items.map((item) => {
      const normalized: NormalizedItem = {
        ...item,
        itemId: item.itemId || this.generateId('item'),
        sourceType: item.sourceType || 'system_note',
        semanticType: item.semanticType || this.inferSemanticType(item.sourceType),
        priority: item.priority ?? 50,
        estimatedTokens: item.estimatedTokens ?? this.estimateTokens(item.content),
        isPinned: item.isPinned ?? false,
        isCompressible: item.isCompressible ?? true,
        isReplaceableByRef: item.isReplaceableByRef ?? false,
        requiresPairIntegrity: item.requiresPairIntegrity ?? false,
        normalizedAt: new Date().toISOString(),
      }
      return normalized
    })

    ctx.report.itemsNormalized = ctx.normalizedItems.length

    this.identifyPairGroups(ctx)
  }

  private filterStage(ctx: PipelineContext): void {
    const now = new Date().toISOString()

    ctx.filteredItems = ctx.normalizedItems.filter((item) => {
      if (item.validUntil && item.validUntil < now) {
        return false
      }
      return true
    })

    ctx.filteredItems = this.handleSupersededItems(ctx.filteredItems)
    ctx.report.itemsFiltered = ctx.filteredItems.length
  }

  private dedupStage(ctx: PipelineContext): void {
    const seenKeys = new Set<string>()
    ctx.dedupedItems = []

    for (const item of ctx.filteredItems) {
      if (!item.dedupeKey) {
        ctx.dedupedItems.push(item)
        continue
      }

      if (!seenKeys.has(item.dedupeKey)) {
        seenKeys.add(item.dedupeKey)
        ctx.dedupedItems.push(item)
      }
    }

    ctx.report.itemsDeduped = ctx.dedupedItems.length
  }

  private scoreStage(ctx: PipelineContext): void {
    ctx.scoredItems = ctx.dedupedItems.map((item) => {
      const priorityScore = (item.priority ?? 50) / 100
      const recencyScore = item.recencyScore ?? this.calculateRecencyScore(item)
      const relevanceScore = item.relevanceScore ?? 0.5
      const authorityScore = item.authorityScore ?? 0.5

      const finalScore = priorityScore * 0.4 + recencyScore * 0.3 + relevanceScore * 0.2 + authorityScore * 0.1

      const scored: ScoredItem = {
        ...item,
        finalScore,
        scoreComponents: {
          priorityScore,
          recencyScore,
          relevanceScore,
          authorityScore,
        },
      }
      return scored
    })

    ctx.scoredItems.sort((a, b) => b.finalScore - a.finalScore)
    ctx.report.itemsScored = ctx.scoredItems.length
  }

  private selectStage(ctx: PipelineContext): void {
    const { tokenBudget, sourceBudgets } = ctx.input.selectionPolicy
    const sourceUsage: Record<string, number> = {}
    const selected: ContextItem[] = []
    const pinned: ContextItem[] = []
    const pairIdsSelected = new Set<string>()

    for (const item of ctx.scoredItems) {
      if (item.isPinned) {
        pinned.push(item)
        if (item.pairId) {
          pairIdsSelected.add(item.pairId)
        }
        continue
      }
    }

    let usedTokens = pinned.reduce((sum, item) => sum + (item.estimatedTokens || 0), 0)

    for (const source of Object.keys(sourceBudgets || {})) {
      sourceUsage[source] = 0
    }

    for (const item of ctx.scoredItems) {
      if (item.isPinned) continue

      const itemTokens = item.estimatedTokens || 0
      const sourceType = item.sourceType

      if (usedTokens + itemTokens > tokenBudget) {
        continue
      }

      if (sourceBudgets && sourceBudgets[sourceType] !== undefined) {
        const currentSourceUsage = sourceUsage[sourceType] || 0
        if (currentSourceUsage + itemTokens > sourceBudgets[sourceType]) {
          continue
        }
        sourceUsage[sourceType] = currentSourceUsage + itemTokens
      }

      if (item.pairId && item.requiresPairIntegrity) {
        if (!pairIdsSelected.has(item.pairId)) {
          const pairGroup = ctx.pairGroups.get(item.pairId)
          if (pairGroup) {
            const pairTokens = pairGroup.reduce((sum, p) => sum + (p.estimatedTokens || 0), 0)

            if (usedTokens + pairTokens > tokenBudget) {
              continue
            }

            const pairItems = pairGroup.filter((p) => !selected.includes(p) && p.itemId !== item.itemId)
            selected.push(...pairItems)
            usedTokens += pairItems.reduce((sum, p) => sum + (p.estimatedTokens || 0), 0)
          }
          pairIdsSelected.add(item.pairId)
        }
      }

      selected.push(item)
      usedTokens += itemTokens
    }

    ctx.selectedItems = [...pinned, ...selected]
    ctx.report.itemsSelected = ctx.selectedItems.length
    ctx.report.pinnedItems = pinned.length
    ctx.report.tokenEstimate = usedTokens
    ctx.report.budgetExceeded = usedTokens > tokenBudget
    ctx.report.pairIntegrityPreserved = Array.from(pairIdsSelected)
  }

  private buildBundle(ctx: PipelineContext): ContextBundle {
    const { input } = ctx
    const pinnedItems = ctx.selectedItems.filter((i) => i.isPinned)
    const orderedItems = ctx.selectedItems.filter((i) => !i.isPinned)

    const compactHints = this.generateCompactHints(ctx)

    return {
      bundleId: ctx.report.bundleId!,
      runId: input.runId,
      agentId: input.agentId,
      agentType: input.agentType,
      userId: input.userId,
      invocationSource: input.invocationSource,
      pinnedItems,
      orderedItems,
      planView: input.planContext?.planContextView,
      workflowStepView: input.workflowContext?.workflowStepContextView,
      backgroundRunView: input.backgroundRunContext?.backgroundRunContextView,
      triggerView: input.triggerContext?.triggerEvent
        ? {
            eventId: input.triggerContext.triggerEvent.eventId,
            eventType: input.triggerContext.triggerEvent.eventType,
            source: input.triggerContext.triggerEvent.source,
            triggerId: input.triggerContext.triggerId,
          }
        : undefined,
      tokenEstimate: ctx.report.tokenEstimate || 0,
      compactHints,
    }
  }

  private identifyPairGroups(ctx: PipelineContext): void {
    const pairMap = new Map<string, ContextItem[]>()

    for (const item of ctx.normalizedItems) {
      if (item.pairId) {
        const group = pairMap.get(item.pairId) || []
        group.push(item)
        pairMap.set(item.pairId, group)
      }
    }

    ctx.pairGroups = pairMap
  }

  private handleSupersededItems(items: ContextItem[]): ContextItem[] {
    const supersedeGroups = new Map<string, ContextItem[]>()

    for (const item of items) {
      if (item.supersedesKey) {
        const group = supersedeGroups.get(item.supersedesKey) || []
        group.push(item)
        supersedeGroups.set(item.supersedesKey, group)
      }
    }

    const itemsToRemove = new Set<string>()

    for (const [, group] of supersedeGroups) {
      if (group.length > 1) {
        group.sort((a, b) => {
          const aTime = a.freshnessTs || a.itemId
          const bTime = b.freshnessTs || b.itemId
          return bTime.localeCompare(aTime)
        })

        for (let i = 1; i < group.length; i++) {
          itemsToRemove.add(group[i].itemId)
        }
      }
    }

    return items.filter((item) => !itemsToRemove.has(item.itemId))
  }

  private generateCompactHints(ctx: PipelineContext): ContextBundle['compactHints'] {
    const { tokenBudget } = ctx.input.selectionPolicy
    const tokenEstimate = ctx.report.tokenEstimate || 0
    const utilizationRatio = tokenEstimate / tokenBudget

    const shouldCompactSoon = utilizationRatio > 0.8

    if (!shouldCompactSoon) {
      return {
        shouldCompactSoon: false,
      }
    }

    const candidateItemIds = ctx.scoredItems
      .filter(
        (item) => !item.isPinned && item.isCompressible && !ctx.selectedItems.some((si) => si.itemId === item.itemId),
      )
      .slice(0, 10)
      .map((item) => item.itemId)

    const mustKeepItemIds = ctx.selectedItems
      .filter((item) => item.isPinned || !item.isReplaceableByRef)
      .map((item) => item.itemId)

    return {
      shouldCompactSoon: true,
      candidateItemIds,
      mustKeepItemIds,
    }
  }

  private generateReport(ctx: PipelineContext): void {
    this.lastReport = ctx.report as ContextSelectionReport
  }

  private inferSemanticType(sourceType: string): ContextItem['semanticType'] {
    const mapping: Record<string, ContextItem['semanticType']> = {
      tool_result: 'tool_output',
      memory: 'search_finding',
      session_history: 'fact',
      conversation_state: 'fact',
      plan_state: 'plan_view',
      workflow_state: 'workflow_step_view',
      background_run_state: 'background_run_view',
      trigger_state: 'trigger_event',
      approval_state: 'entity_state',
      subagent_result: 'tool_output',
      artifact: 'attachment_ref',
      attachment: 'attachment_ref',
      system_note: 'instruction',
    }

    return mapping[sourceType] || 'fact'
  }

  private estimateTokens(content: string): number {
    const words = content.split(/\s+/).length
    return Math.ceil(words * 1.3)
  }

  private calculateRecencyScore(item: ContextItem): number {
    if (!item.freshnessTs) return 0.5

    const age = Date.now() - new Date(item.freshnessTs).getTime()
    const oneHour = 60 * 60 * 1000
    const oneDay = 24 * oneHour

    if (age < oneHour) return 1.0
    if (age < oneDay) return 0.7
    return 0.3
  }

  private createTurnItem(
    turn: { turnId: string; role: 'user' | 'assistant'; summary: string },
    _idx: number,
  ): ContextItem {
    return {
      itemId: turn.turnId,
      sourceType: 'session_history',
      semanticType: 'fact',
      content: `${turn.role}: ${turn.summary}`,
      estimatedTokens: this.estimateTokens(turn.summary),
    }
  }

  private createToolResultItem(result: string, idx: number): ContextItem {
    return {
      itemId: `tool-result-${idx}`,
      sourceType: 'tool_result',
      semanticType: 'tool_output',
      content: result,
      estimatedTokens: this.estimateTokens(result),
    }
  }

  private createSubagentResultItem(result: string, idx: number): ContextItem {
    return {
      itemId: `subagent-result-${idx}`,
      sourceType: 'subagent_result',
      semanticType: 'tool_output',
      content: result,
      estimatedTokens: this.estimateTokens(result),
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

export function createContextManager(): ContextManager {
  return new ContextManager()
}
