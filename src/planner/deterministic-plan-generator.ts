import type {
  PlanGenerationInput,
  PlanGenerationOutput,
  ExecutionPlan,
  PlanStep,
  PlanStepKind,
  PlanExecutor,
  PlanDependency,
  ApprovalRequirement,
  PlanRiskLevel,
} from './plan-schema.js'
import type { PlanGenerator } from './plan-generator-interface.js'

export interface ToolClassifier {
  isWriteTool(toolName: string): boolean
}

const WRITE_KEYWORDS = /(?:write|create|delete|remove|update|save|modify|edit|send|issue|修改|创建|发送|删除|写入)/i

function generateDeterministicId(goal: string, prefix: string, index: number): string {
  let hash = 0
  const str = goal + prefix + index
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return `${prefix}${Math.abs(hash).toString(16).substring(0, 8)}`
}

function isCjkText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const cjkCount = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  return cjkCount > trimmed.length * 0.3
}

function isWriteGoal(goal: string): boolean {
  return WRITE_KEYWORDS.test(goal)
}

function isComplexGoal(goal: string): boolean {
  if (isWriteGoal(goal)) return true

  const trimmed = goal.trim()
  if (isCjkText(trimmed)) {
    return trimmed.length > 20
  }

  return trimmed.split(/\s+/).length > 5
}

function pickReadTool(availableTools: string[], classifier?: ToolClassifier): string {
  if (availableTools.length === 0) return 'read_file'
  const readTool = availableTools.find((t) => !classifier?.isWriteTool(t))
  return readTool ?? availableTools[0]
}

function pickWriteTool(availableTools: string[], classifier?: ToolClassifier): string | null {
  if (availableTools.length === 0) return null
  const writeTool = availableTools.find((t) => classifier?.isWriteTool(t))
  return writeTool ?? null
}

function buildToolCallStep(
  id: string,
  toolName: string,
  title: string,
  description: string,
  dependsOn?: PlanDependency[],
  approvalRequirementId?: string,
): PlanStep {
  return {
    id,
    kind: 'tool_call' as PlanStepKind,
    title,
    description,
    executor: 'tool_plane' as PlanExecutor,
    toolName,
    dependsOn,
    approvalRequirementId,
  }
}

function buildApprovalStep(id: string, approvalId: string, reason: string, dependsOn?: PlanDependency[]): PlanStep {
  return {
    id,
    kind: 'user_approval' as PlanStepKind,
    title: 'Approval Required',
    description: reason,
    executor: 'foreground' as PlanExecutor,
    dependsOn,
    approvalRequirementId: approvalId,
  }
}

function buildFinalResponseStep(id: string, dependsOn?: PlanDependency[]): PlanStep {
  return {
    id,
    kind: 'final_response' as PlanStepKind,
    title: 'Respond to User',
    description: 'Summarize results and respond to user',
    executor: 'foreground' as PlanExecutor,
    dependsOn,
  }
}

export class DeterministicPlanGenerator implements PlanGenerator {
  private toolClassifier?: ToolClassifier

  constructor(toolClassifier?: ToolClassifier) {
    this.toolClassifier = toolClassifier
  }

  generate(input: PlanGenerationInput): PlanGenerationOutput {
    const { goal, availableTools = [], constraints } = input
    const maxSteps = constraints?.maxSteps ?? 10
    const complex = isComplexGoal(goal)

    const steps = this.generateSteps(goal, availableTools, complex, maxSteps)
    const requiredApprovals = this.collectApprovals(steps)

    const now = new Date().toISOString()
    const plan: ExecutionPlan = {
      id: generateDeterministicId(goal, 'plan_', 0),
      goal,
      steps,
      requiredApprovals: requiredApprovals.length > 0 ? requiredApprovals : undefined,
      successCriteria: this.generateSuccessCriteria(steps),
      createdAt: now,
      updatedAt: now,
      version: 1,
    }

    return { plan }
  }

  private generateSteps(goal: string, availableTools: string[], complex: boolean, maxSteps: number): PlanStep[] {
    const steps: PlanStep[] = []
    const classifier = this.toolClassifier
    const hasWriteIntent = isWriteGoal(goal)
    const stepIds: string[] = []

    const nextId = (index: number): string => {
      const id = generateDeterministicId(goal, 'step_', index)
      stepIds.push(id)
      return id
    }

    let stepIndex = 0

    // Respect maxSteps: need at least 2 (1 tool_call + 1 final_response)
    const effectiveMax = Math.max(maxSteps, 2)

    if (!complex && effectiveMax <= 2) {
      // Simple goal, limited steps: 1 tool_call + final_response
      const toolName = pickReadTool(availableTools, classifier)
      const step1 = buildToolCallStep(
        nextId(stepIndex++),
        toolName,
        'Execute Query',
        `Execute "${toolName}" for goal: ${goal}`,
      )
      steps.push(step1)

      const finalDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: step1.id }]
      steps.push(buildFinalResponseStep(nextId(stepIndex++), finalDep))
      return steps
    }

    if (complex && hasWriteIntent && effectiveMax >= 3) {
      // Complex write goal: analyze → approval → execute → final_response
      const readTool = pickReadTool(availableTools, classifier)
      const step1 = buildToolCallStep(
        nextId(stepIndex++),
        readTool,
        'Analyze Request',
        `Analyze context and requirements for: ${goal}`,
      )
      steps.push(step1)

      const approvalId = generateDeterministicId(goal, 'approval_', stepIndex)
      const approvalDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: step1.id }]
      const approvalStep = buildApprovalStep(
        nextId(stepIndex++),
        approvalId,
        `Write operation requested: ${goal}`,
        approvalDep,
      )
      steps.push(approvalStep)

      const writeTool = pickWriteTool(availableTools, classifier)
      if (effectiveMax >= 4) {
        const execDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: approvalStep.id }]
        const execStep = buildToolCallStep(
          nextId(stepIndex++),
          writeTool ?? 'write_file',
          'Execute Action',
          `Execute primary write action for: ${goal}`,
          execDep,
          approvalId,
        )
        steps.push(execStep)

        const finalDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: execStep.id }]
        steps.push(buildFinalResponseStep(nextId(stepIndex++), finalDep))
      } else {
        const finalDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: approvalStep.id }]
        steps.push(buildFinalResponseStep(nextId(stepIndex++), finalDep))
      }
      return steps
    }

    if (complex && !hasWriteIntent && effectiveMax >= 3) {
      // Complex read/analyze goal: analyze → execute → final_response
      const readTool = pickReadTool(availableTools, classifier)
      const step1 = buildToolCallStep(
        nextId(stepIndex++),
        readTool,
        'Analyze Request',
        `Gather context and analyze: ${goal}`,
      )
      steps.push(step1)

      const step1Dep: PlanDependency[] = [{ type: 'depends_on', targetStepId: step1.id }]

      if (effectiveMax >= 4) {
        const secondTool = availableTools.length > 1 ? availableTools[1] : readTool
        const step2 = buildToolCallStep(
          nextId(stepIndex++),
          secondTool,
          'Execute Action',
          `Execute action for: ${goal}`,
          step1Dep,
        )
        steps.push(step2)

        const finalDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: step2.id }]
        steps.push(buildFinalResponseStep(nextId(stepIndex++), finalDep))
      } else {
        steps.push(buildFinalResponseStep(nextId(stepIndex++), step1Dep))
      }
      return steps
    }

    // Fallback: simple path (tool_call + final_response)
    const toolName = pickReadTool(availableTools, classifier)
    const step1 = buildToolCallStep(
      nextId(stepIndex++),
      toolName,
      'Execute Query',
      `Execute "${toolName}" for goal: ${goal}`,
    )
    steps.push(step1)

    const finalDep: PlanDependency[] = [{ type: 'depends_on', targetStepId: step1.id }]
    steps.push(buildFinalResponseStep(nextId(stepIndex++), finalDep))
    return steps
  }

  private collectApprovals(steps: PlanStep[]): ApprovalRequirement[] {
    const seen = new Set<string>()
    const approvals: ApprovalRequirement[] = []
    for (const step of steps) {
      if (step.approvalRequirementId && !seen.has(step.approvalRequirementId)) {
        seen.add(step.approvalRequirementId)
        approvals.push({
          approvalId: step.approvalRequirementId,
          reason: step.description || 'Approval required for this operation',
          riskLevel: 'medium' as PlanRiskLevel,
        })
      }
    }
    return approvals
  }

  private generateSuccessCriteria(steps: PlanStep[]): string[] {
    const criteria: string[] = []
    const toolSteps = steps.filter((s) => s.kind === 'tool_call')
    for (const step of toolSteps) {
      criteria.push(`${step.toolName ?? 'action'} completed successfully`)
    }
    criteria.push('User receives clear final response')
    return criteria
  }
}
