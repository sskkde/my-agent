import type { ConditionEvalResult } from './types.js';

interface EvaluationContext {
  stepOutputs: Map<string, unknown>;
  inputData?: Record<string, unknown>;
}

interface ParsedExpression {
  type: 'comparison' | 'logical' | 'literal' | 'identifier';
  operator?: string;
  left?: ParsedExpression;
  right?: ParsedExpression;
  value?: unknown;
  identifier?: string;
}

class ExpressionEvaluator {
  private stepOutputs: Map<string, unknown>;
  private inputData?: Record<string, unknown>;

  constructor(context: EvaluationContext) {
    this.stepOutputs = context.stepOutputs;
    this.inputData = context.inputData;
  }

  evaluate(expression: string): ConditionEvalResult {
    try {
      const parsed = this.parseExpression(expression);
      const result = this.evalNode(parsed);

      if (result.error) {
        return {
          conditionMet: false,
          error: result.error,
        };
      }

      return {
        conditionMet: Boolean(result.value),
      };
    } catch (error) {
      return {
        conditionMet: false,
        error: {
          code: 'EXPRESSION_ERROR',
          message: error instanceof Error ? error.message : 'Expression evaluation failed',
        },
      };
    }
  }

  private parseExpression(expr: string): ParsedExpression {
    const trimmed = expr.trim();

    if (trimmed.includes('&&') || trimmed.includes('||')) {
      return this.parseLogicalExpression(trimmed);
    }

    if (this.isComparisonExpression(trimmed)) {
      return this.parseComparisonExpression(trimmed);
    }

    if (this.isLiteral(trimmed)) {
      return this.parseLiteral(trimmed);
    }

    return {
      type: 'identifier',
      identifier: trimmed,
    };
  }

  private isComparisonExpression(expr: string): boolean {
    const operators = ['==', '!=', '<=', '>=', '<', '>'];
    return operators.some(op => expr.includes(op));
  }

  private parseLogicalExpression(expr: string): ParsedExpression {
    const logicalOps = ['&&', '||'];

    for (const op of logicalOps) {
      const parts = this.splitByOperator(expr, op);
      if (parts) {
        return {
          type: 'logical',
          operator: op,
          left: this.parseExpression(parts.left),
          right: this.parseExpression(parts.right),
        };
      }
    }

    throw new Error(`Invalid logical expression: ${expr}`);
  }

  private parseComparisonExpression(expr: string): ParsedExpression {
    const operators = ['==', '!=', '<=', '>=', '<', '>'];

    for (const op of operators) {
      const parts = this.splitByOperator(expr, op);
      if (parts) {
        return {
          type: 'comparison',
          operator: op,
          left: this.parseExpression(parts.left),
          right: this.parseExpression(parts.right),
        };
      }
    }

    throw new Error(`Invalid comparison expression: ${expr}`);
  }

  private splitByOperator(expr: string, op: string): { left: string; right: string } | null {
    const index = expr.indexOf(op);
    if (index === -1) return null;

    return {
      left: expr.substring(0, index).trim(),
      right: expr.substring(index + op.length).trim(),
    };
  }

  private isLiteral(expr: string): boolean {
    if (expr.startsWith('"') && expr.endsWith('"')) return true;
    if (expr.startsWith("'") && expr.endsWith("'")) return true;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return true;
    if (expr === 'true' || expr === 'false') return true;
    return false;
  }

  private parseLiteral(expr: string): ParsedExpression {
    if (expr.startsWith('"') && expr.endsWith('"')) {
      return { type: 'literal', value: expr.slice(1, -1) };
    }
    if (expr.startsWith("'") && expr.endsWith("'")) {
      return { type: 'literal', value: expr.slice(1, -1) };
    }
    if (expr === 'true') {
      return { type: 'literal', value: true };
    }
    if (expr === 'false') {
      return { type: 'literal', value: false };
    }
    if (/^-?\d+$/.test(expr)) {
      return { type: 'literal', value: parseInt(expr, 10) };
    }
    if (/^-?\d+\.\d+$/.test(expr)) {
      return { type: 'literal', value: parseFloat(expr) };
    }

    throw new Error(`Invalid literal: ${expr}`);
  }

  private evalNode(node: ParsedExpression): { value: unknown; error?: ConditionEvalResult['error'] } {
    switch (node.type) {
      case 'literal':
        return { value: node.value };

      case 'identifier':
        return this.resolveIdentifier(node.identifier!);

      case 'comparison':
        return this.evalComparison(node);

      case 'logical':
        return this.evalLogical(node);

      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  private resolveIdentifier(identifier: string): { value: unknown; error?: ConditionEvalResult['error'] } {
    const parts = identifier.split('.');

    if (parts.length === 0) {
      return {
        value: undefined,
        error: {
          code: 'UNDEFINED_VARIABLE',
          message: `Empty identifier`,
          variableName: identifier,
        },
      };
    }

    const rootIdentifier = parts[0];
    if (!rootIdentifier) {
      return {
        value: undefined,
        error: {
          code: 'UNDEFINED_VARIABLE',
          message: `Invalid identifier: ${identifier}`,
          variableName: identifier,
        },
      };
    }

    let current: unknown;

    if (rootIdentifier === 'input') {
      current = this.inputData;
    } else if (this.stepOutputs.has(rootIdentifier)) {
      current = this.stepOutputs.get(rootIdentifier);
    } else {
      return {
        value: undefined,
        error: {
          code: 'UNDEFINED_VARIABLE',
          message: `Undefined variable: ${rootIdentifier}`,
          variableName: rootIdentifier,
        },
      };
    }

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) {
        return {
          value: undefined,
          error: {
            code: 'UNDEFINED_VARIABLE',
            message: `Invalid path in identifier: ${identifier}`,
            variableName: identifier,
          },
        };
      }

      if (current === null || current === undefined) {
        return {
          value: undefined,
          error: {
            code: 'UNDEFINED_VARIABLE',
            message: `Cannot access property '${part}' of null or undefined`,
            variableName: `${parts.slice(0, i).join('.')}`,
          },
        };
      }

      if (typeof current !== 'object') {
        return {
          value: undefined,
          error: {
            code: 'UNDEFINED_VARIABLE',
            message: `Cannot access property '${part}' on non-object value`,
            variableName: `${parts.slice(0, i).join('.')}`,
          },
        };
      }

      const record = current as Record<string, unknown>;
      if (!(part in record)) {
        return {
          value: undefined,
          error: {
            code: 'UNDEFINED_VARIABLE',
            message: `Property '${part}' not found on ${parts.slice(0, i).join('.')}`,
            variableName: `${parts.slice(0, i + 1).join('.')}`,
          },
        };
      }

      current = record[part];
    }

    return { value: current };
  }

  private evalComparison(node: ParsedExpression): { value: boolean; error?: ConditionEvalResult['error'] } {
    const leftResult = this.evalNode(node.left!);
    if (leftResult.error) {
      return { value: false, error: leftResult.error };
    }

    const rightResult = this.evalNode(node.right!);
    if (rightResult.error) {
      return { value: false, error: rightResult.error };
    }

    const left = leftResult.value;
    const right = rightResult.value;
    const op = node.operator!;

    let result: boolean;

    switch (op) {
      case '==':
        result = left == right;
        break;
      case '!=':
        result = left != right;
        break;
      case '<':
        result = this.compareValues(left, right) < 0;
        break;
      case '>':
        result = this.compareValues(left, right) > 0;
        break;
      case '<=':
        result = this.compareValues(left, right) <= 0;
        break;
      case '>=':
        result = this.compareValues(left, right) >= 0;
        break;
      default:
        throw new Error(`Unknown comparison operator: ${op}`);
    }

    return { value: result };
  }

  private compareValues(left: unknown, right: unknown): number {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }

    if (typeof left === 'string' && typeof right === 'string') {
      return left.localeCompare(right);
    }

    const leftStr = String(left);
    const rightStr = String(right);
    return leftStr.localeCompare(rightStr);
  }

  private evalLogical(node: ParsedExpression): { value: boolean; error?: ConditionEvalResult['error'] } {
    const leftResult = this.evalNode(node.left!);
    if (leftResult.error) {
      return { value: false, error: leftResult.error };
    }

    if (node.operator === '&&') {
      if (!leftResult.value) {
        return { value: false };
      }

      const rightResult = this.evalNode(node.right!);
      if (rightResult.error) {
        return { value: false, error: rightResult.error };
      }

      return { value: Boolean(rightResult.value) };
    }

    if (node.operator === '||') {
      if (leftResult.value) {
        return { value: true };
      }

      const rightResult = this.evalNode(node.right!);
      if (rightResult.error) {
        return { value: false, error: rightResult.error };
      }

      return { value: Boolean(rightResult.value) };
    }

    throw new Error(`Unknown logical operator: ${node.operator}`);
  }
}

export function createExpressionEvaluator(context: EvaluationContext): ExpressionEvaluator {
  return new ExpressionEvaluator(context);
}

export function evaluateConditionExpression(
  expression: string,
  stepOutputs: Map<string, unknown>,
  inputData?: Record<string, unknown>
): ConditionEvalResult {
  const evaluator = new ExpressionEvaluator({ stepOutputs, inputData });
  return evaluator.evaluate(expression);
}
