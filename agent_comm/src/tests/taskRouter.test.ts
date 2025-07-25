import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimpleTaskRouter } from '../services/taskRouter';
import { InMemoryAgentRegistry } from '../services/agentRegistry';
import { AgentTask, TaskStatus, AgentStatus, RegisteredAgent } from '../types/orchestration';

describe('SimpleTaskRouter', () => {
    let router: SimpleTaskRouter;
    let registry: InMemoryAgentRegistry;
    let mockTask: AgentTask;
    let mockAgent: RegisteredAgent;

    beforeEach(() => {
        registry = new InMemoryAgentRegistry();
        router = new SimpleTaskRouter(registry);
        
        mockAgent = {
            id: 'test-agent',
            name: 'Test Agent',
            endpoint: 'http://localhost:3000',
            capabilities: [{
                name: 'test-capability',
                methods: ['test-method'],
                version: '1.0.0'
            }],
            status: AgentStatus.ONLINE,
            lastSeen: new Date()
        };

        mockTask = {
            id: '123',
            method: 'test-method',
            params: {},
            sourceAgent: 'source-agent',
            targetAgent: 'test-agent',
            status: TaskStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date()
        };
    });

    it('should route task to specified target agent if capable', async () => {
        await registry.register(mockAgent);
        const targetId = await router.route(mockTask);
        expect(targetId).toBe('test-agent');
    });

    it('should throw error if specified target agent cannot handle task', async () => {
        await registry.register(mockAgent);
        const invalidTask = { ...mockTask, method: 'unknown-method' };
        await expect(router.route(invalidTask))
            .rejects.toThrow('Target agent test-agent cannot handle task unknown-method');
    });

    it('should find first capable agent if no target specified', async () => {
        await registry.register(mockAgent);
        const untargetedTask = { ...mockTask, targetAgent: '' };
        const targetId = await router.route(untargetedTask);
        expect(targetId).toBe('test-agent');
    });

    it('should throw error if no agent can handle untargeted task', async () => {
        await registry.register(mockAgent);
        const invalidTask = { ...mockTask, targetAgent: '', method: 'unknown-method' };
        await expect(router.route(invalidTask))
            .rejects.toThrow('No agent found capable of handling task unknown-method');
    });

    it('should verify if agent can handle task', async () => {
        await registry.register(mockAgent);
        const canHandle = await router.canHandle(mockTask);
        expect(canHandle).toBe(true);
    });

    it('should return false for non-existent target agent', async () => {
        const canHandle = await router.canHandle(mockTask);
        expect(canHandle).toBe(false);
    });

    it('should return false for task without target agent', async () => {
        const untargetedTask = { ...mockTask, targetAgent: '' };
        const canHandle = await router.canHandle(untargetedTask);
        expect(canHandle).toBe(false);
    });

    it('should handle multiple agents with same capabilities', async () => {
        await registry.register(mockAgent);
        await registry.register({
            ...mockAgent,
            id: 'test-agent-2',
            name: 'Test Agent 2'
        });

        const untargetedTask = { ...mockTask, targetAgent: '' };
        const targetId = await router.route(untargetedTask);
        // Should route to first capable agent
        expect(targetId).toBe('test-agent');
    });
});