import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BasicOrchestrator } from '../services/orchestrator';
import { InMemoryTaskQueue } from '../services/taskQueue';
import { InMemoryAgentRegistry } from '../services/agentRegistry';
import { SimpleTaskRouter } from '../services/taskRouter';
import { AgentTask, TaskStatus, AgentStatus, RegisteredAgent } from '../types/orchestration';

describe('BasicOrchestrator', () => {
    let orchestrator: BasicOrchestrator;
    let taskQueue: InMemoryTaskQueue;
    let agentRegistry: InMemoryAgentRegistry;
    let taskRouter: SimpleTaskRouter;
    let mockTask: Partial<AgentTask>;
    let mockAgent: RegisteredAgent;

    beforeEach(() => {
        vi.useFakeTimers();
        taskQueue = new InMemoryTaskQueue(100);
        agentRegistry = new InMemoryAgentRegistry();
        taskRouter = new SimpleTaskRouter(agentRegistry);
        
        orchestrator = new BasicOrchestrator(
            taskQueue,
            agentRegistry,
            taskRouter,
            {
                retryAttempts: 2,
                retryDelay: 100
            }
        );

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
            method: 'test-method',
            params: {},
            sourceAgent: 'source-agent',
            targetAgent: 'test-agent'
        };
    });

    it('should submit task and return task ID', async () => {
        await agentRegistry.register(mockAgent);
        const taskId = await orchestrator.submitTask(mockTask);
        expect(taskId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('should get task status', async () => {
        await agentRegistry.register(mockAgent);
        const taskId = await orchestrator.submitTask(mockTask);
        const status = await orchestrator.getTaskStatus(taskId);
        expect(status).toBe(TaskStatus.PENDING);
    });

    it('should throw error for non-existent task status', async () => {
        await expect(orchestrator.getTaskStatus('non-existent'))
            .rejects.toThrow('Task non-existent not found');
    });

    it('should cancel pending task', async () => {
        await agentRegistry.register(mockAgent);
        const taskId = await orchestrator.submitTask(mockTask);
        const cancelled = await orchestrator.cancelTask(taskId);
        expect(cancelled).toBe(true);
        
        const status = await orchestrator.getTaskStatus(taskId);
        expect(status).toBe(TaskStatus.FAILED);
    });

    it('should return false when cancelling non-existent task', async () => {
        const cancelled = await orchestrator.cancelTask('non-existent');
        expect(cancelled).toBe(false);
    });

    it('should provide metrics', async () => {
        await agentRegistry.register(mockAgent);
        await orchestrator.submitTask(mockTask);
        
        // Fast-forward time to allow processing and metrics update
        await vi.advanceTimersByTimeAsync(100); // Process task
        await vi.runOnlyPendingTimersAsync(); // Run all pending timers
        
        const metrics = await orchestrator.getMetrics();
        expect(metrics).toMatchObject({
            taskCount: 1,
            completedTasks: expect.any(Number),
            failedTasks: expect.any(Number),
            averageProcessingTime: expect.any(Number),
            activeAgents: 1
        });
    });

    it('should handle task routing when target not specified', async () => {
        await agentRegistry.register(mockAgent);
        const untargetedTask = { ...mockTask, targetAgent: undefined };
        const taskId = await orchestrator.submitTask(untargetedTask);
        expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should handle task submission failures', async () => {
        // No agents registered, should fail to route
        await expect(orchestrator.submitTask(mockTask))
            .rejects.toThrow('Target agent test-agent not found');
    });

    it('should retry failed task processing', async () => {
        await agentRegistry.register(mockAgent);
        const taskId = await orchestrator.submitTask(mockTask);
        
        // Fast-forward time to allow processing
        await vi.advanceTimersByTimeAsync(2000);
        
        const status = await orchestrator.getTaskStatus(taskId);
        expect(status).toBe(TaskStatus.COMPLETED);
    });
});