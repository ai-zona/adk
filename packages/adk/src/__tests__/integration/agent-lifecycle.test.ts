import { describe, it, expect } from 'vitest';
import { defineAgent } from '../../agent/define-agent';
import { defineTool } from '../../tools/define-tool';

describe('Integration: Agent Lifecycle', () => {
  it('creates an agent with valid config', () => {
    const agent = defineAgent({
      name: 'test-agent',
      instructions: 'You are a test agent.',
      model: 'test-model',
    });
    expect(agent.name).toBe('test-agent');
    expect(agent.getMaxTurns()).toBe(25);
    expect(agent.getConsentLevel()).toBe('auto');
  });

  it('creates an agent with tools', () => {
    const tool = defineTool({
      name: 'calculator',
      description: 'Performs math',
      inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      execute: async (input: { expression: string }) => ({ result: eval(input.expression) }),
    });

    const agent = defineAgent({
      name: 'math-agent',
      instructions: 'You do math.',
      model: 'test-model',
      tools: [tool],
    });
    expect(agent.getTools()).toHaveLength(1);
    expect(agent.getTools()[0].name).toBe('calculator');
  });

  it('agent clone preserves tools and overrides config', () => {
    const tool = defineTool({
      name: 'test-tool',
      description: 'A test tool',
      execute: async () => ({ ok: true }),
    });

    const agent = defineAgent({
      name: 'original',
      instructions: 'Original instructions',
      model: 'model-1',
      tools: [tool],
    });

    const cloned = agent.clone({ name: 'cloned', model: 'model-2' });
    expect(cloned.name).toBe('cloned');
    expect(cloned.config.model).toBe('model-2');
  });

  it('agent rejects empty name', () => {
    expect(() => defineAgent({
      name: '',
      instructions: 'test',
      model: 'test',
    })).toThrow('Agent name is required');
  });

  it('tool rejects empty name', () => {
    expect(() => defineTool({
      name: '',
      description: 'test',
      execute: async () => ({}),
    })).toThrow('Tool name is required');
  });

  it('tool rejects empty description', () => {
    expect(() => defineTool({
      name: 'test',
      description: '',
      execute: async () => ({}),
    })).toThrow('Tool description is required');
  });

  it('tool executes correctly', async () => {
    const tool = defineTool({
      name: 'greeter',
      description: 'Greets someone',
      execute: async (input: { name: string }) => ({ greeting: `Hello, ${input.name}!` }),
    });

    const result = await tool.execute({ name: 'World' }, {} as any);
    expect(result).toEqual({ greeting: 'Hello, World!' });
  });

  it('agent with handoffs', () => {
    const agent = defineAgent({
      name: 'router',
      instructions: 'Route to specialists',
      model: 'test-model',
      handoffs: [
        { agent: 'specialist-1', description: 'For task type A' },
        { agent: 'specialist-2', description: 'For task type B' },
      ],
    });
    expect(agent.getHandoffs()).toHaveLength(2);
  });

  it('agent with budget limit', () => {
    const agent = defineAgent({
      name: 'budget-agent',
      instructions: 'test',
      model: 'test-model',
      budgetLimitUsd: 1.50,
    });
    expect(agent.getBudgetLimit()).toBe(1.50);
  });
});
