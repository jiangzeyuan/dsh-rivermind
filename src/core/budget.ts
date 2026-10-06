import { PokerError } from './types.js';

export interface AgentBudget { timeoutSeconds: number; maxToolCalls: number }
export const DEFAULT_AGENT_BUDGET: Readonly<AgentBudget> = Object.freeze({ timeoutSeconds: 60, maxToolCalls: 10 });
export const BUDGET_LIMITS = { timeoutSeconds: { min: 5, max: 300 }, maxToolCalls: { min: 1, max: 32 } } as const;
export function validateAgentBudget(value: unknown): AgentBudget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PokerError('BAD_BUDGET', '请提供思考时限和工具调用上限。', 400);
  }
  const budget = value as Record<string, unknown>;
  if (Object.keys(budget).some(key => key !== 'timeoutSeconds' && key !== 'maxToolCalls')) {
    throw new PokerError('BAD_BUDGET', '未知的 Iris 预算设置。', 400);
  }
  for (const key of ['timeoutSeconds', 'maxToolCalls'] as const) {
    const n = budget[key], limits = BUDGET_LIMITS[key];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < limits.min || n > limits.max) {
      throw new PokerError('BAD_BUDGET', key === 'timeoutSeconds' ? '思考时限须为 5～300 秒的整数。' : '工具调用上限须为 1～32 次的整数。', 400);
    }
  }
  return { timeoutSeconds: budget.timeoutSeconds as number, maxToolCalls: budget.maxToolCalls as number };
}
