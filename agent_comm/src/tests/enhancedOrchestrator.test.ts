import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnhancedOrchestrator } from '../services/orchestrator';
import { InMemoryTaskQueue } from '../services/taskQueue';
import { InMemoryAgentRegistry } from '../services/agentRegistry';
import { SimpleTaskRouter } from '../services/taskRouter';
import { AgentTask, TaskStatus, AgentStatus, RegisteredAgent } from '../types/orchestration';

describe('EnhancedOrchestrator Phase 1', () => {
    let orchestrator: EnhancedOrchestrator;
    let taskQueue: InMemoryTaskQueue;
    let agentRegistry: InMemoryAgentRegistry;
    let taskRouter: SimpleTaskRouter;
    let mockAgents: RegisteredAgent[];
    let mockTask: Partial<AgentTask>;

    global.fetch = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        taskQueue = new InMemoryTaskQueue(100);
        agentRegistry = new InMemoryAgentRegistry();
        taskRouter = new SimpleTaskRouter(agentRegistry);
        
        orchestrator = new EnhancedOrchestrator(
            taskQueue,
            agentRegistry,
            taskRouter,
            {
                retryAttempts: 2,
                retryDelay: 100,
                maxConcurrentTasks: 3
            }
        );

        // Create multiple mock agents with different capabilities
        mockAgents = [
            {
                id: 'claude-agent',
                name: 'Claude Agent',
                endpoint: 'http://localhost:5000',
                capabilities: [{
                    name: 'code-refactor',
                    methods: ['RequestRefactor'],
                    version: '1.0.0'
                }],
                status: AgentStatus.ONLINE,
                lastSeen: new Date()
            },
            {
                id: 'gemini-agent',
                name: 'Gemini Agent',
                endpoint: 'http://localhost:5001',
                capabilities: [{
                    name: 'code-analysis',
                    methods: ['AnalyzeCode', 'RequestRefactor'],
                    version: '1.0.0'
                }],
                status: AgentStatus.ONLINE,
                lastSeen: new Date()
            }
        ];

        mockTask = {
            method: 'RequestRefactor',
            params: {
                code_path: '/test/path',
                instruction: 'Refactor this code'
            },
            sourceAgent: 'user'
        };

        // Mock fetch responses
        (global.fetch as any).mockReset();
    });

    afterEach(() => {
        orchestrator.cleanup();
        vi.clearAllTimers();
        vi.clearAllMocks();
    });

    describe('Capability-based Routing', () => {
        it('should route task to agent with matching capability', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
            };
            (global.fetch as any).mockResolvedValue(mockResponse);

            const taskId = await orchestrator.submitTask(mockTask);
            await vi.advanceTimersByTimeAsync(200);

            const task = await taskQueue.getTask(taskId);
            expect(task?.targetAgent).toBeDefined();
            expect(['claude-agent', 'gemini-agent']).toContain(task?.targetAgent);
        });

        it('should fail when no agent has required capability', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            const unsupportedTask = {
                ...mockTask,
                method: 'UnsupportedMethod'
            };

            await expect(orchestrator.submitTask(unsupportedTask))
                .rejects.toThrow('No agent available with capability: UnsupportedMethod');
        });
    });

    describe('Parallel Execution', () => {
        it('should handle multiple tasks concurrently', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
            };
            (global.fetch as any).mockResolvedValue(mockResponse);

            // Submit multiple tasks
            const taskPromises = Array(5).fill(null).map(() => 
                orchestrator.submitTask(mockTask)
            );
            const taskIds = await Promise.all(taskPromises);

            // Fast forward time to allow processing
            await vi.advanceTimersByTimeAsync(1000);

            // Check that tasks were processed
            const taskStatuses = await Promise.all(
                taskIds.map(id => orchestrator.getTaskStatus(id))
            );

            // All tasks should be either completed or in progress
            taskStatuses.forEach(status => {
                expect([TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS]).toContain(status);
            });

            // Should not exceed max concurrent tasks
            const metrics = await orchestrator.getMetrics();
            expect(metrics.activeAgents).toBeLessThanOrEqual(3);
        });
    });

    describe('Task Dependencies', () => {
        it('should handle task dependencies correctly', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
            };
            (global.fetch as any).mockResolvedValue(mockResponse);

            // Create first task
            const task1Id = await orchestrator.submitTask(mockTask);

            // Create dependent task
            const dependentTask = {
                ...mockTask,
                params: {
                    ...mockTask.params,
                    dependencies: [task1Id]
                }
            };
            const task2Id = await orchestrator.submitTask(dependentTask);

            // Fast forward time
            await vi.advanceTimersByTimeAsync(500);

            // Check task statuses
            const task1Status = await orchestrator.getTaskStatus(task1Id);
            const task2Status = await orchestrator.getTaskStatus(task2Id);

            expect(task1Status).toBe(TaskStatus.COMPLETED);
            expect([TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS, TaskStatus.PENDING]).toContain(task2Status);
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should handle agent communication errors', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            // Mock a failed response
            (global.fetch as any)
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
                });

            const taskId = await orchestrator.submitTask(mockTask);
            await vi.advanceTimersByTimeAsync(500);

            const status = await orchestrator.getTaskStatus(taskId);
            expect(status).toBe(TaskStatus.COMPLETED);
        });

        it('should handle agent unavailability', async () => {
            // Register agents but set one as offline
            const offlineAgent = { ...mockAgents[0], status: AgentStatus.OFFLINE };
            const onlineAgent = mockAgents[1];
            
            await agentRegistry.register(offlineAgent);
            await agentRegistry.register(onlineAgent);

            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
            };
            (global.fetch as any).mockResolvedValue(mockResponse);

            const taskId = await orchestrator.submitTask(mockTask);
            await vi.advanceTimersByTimeAsync(200);

            const task = await taskQueue.getTask(taskId);
            expect(task?.targetAgent).toBe(onlineAgent.id);
        });
    });

    describe('JSON-RPC Communication', () => {
        it('should send correct JSON-RPC requests', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
            };
            (global.fetch as any).mockResolvedValue(mockResponse);

            const taskId = await orchestrator.submitTask(mockTask);
            await vi.advanceTimersByTimeAsync(200);

            // Verify the JSON-RPC request format
            expect(global.fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json'
                    }),
                    body: expect.stringContaining('"jsonrpc":"2.0"')
                })
            );

            const requestBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
            expect(requestBody).toMatchObject({
                jsonrpc: '2.0',
                method: mockTask.method,
                params: mockTask.params,
                id: taskId
            });
        });

        it('should handle JSON-RPC error responses', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            // Mock an error response
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    error: {
                        code: -32601,
                        message: 'Method not found'
                    },
                    id: 1
                })
            });

            const taskId = await orchestrator.submitTask(mockTask);
            await vi.advanceTimersByTimeAsync(200);

            const task = await taskQueue.getTask(taskId);
            expect(task?.status).toBe(TaskStatus.FAILED);
            expect(task?.error).toContain('Method not found');
        });
    });

    describe('Metrics and Monitoring', () => {
        it('should track task execution metrics', async () => {
            await Promise.all(mockAgents.map(agent => agentRegistry.register(agent)));
            
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ jsonrpc: '2.0', result: 'success', id: 1 })
            };
            (global.fetch as any).mockResolvedValue(mockResponse);

            // Submit multiple tasks
            await Promise.all(Array(5).fill(null).map(() => 
                orchestrator.submitTask(mockTask)
            ));

            // Fast forward time
            await vi.advanceTimersByTimeAsync(5000);

            const metrics = await orchestrator.getMetrics();
            expect(metrics).toMatchObject({
                taskCount: 5,
                completedTasks: expect.any(Number),
                failedTasks: expect.any(Number),
                averageProcessingTime: expect.any(Number),
                activeAgents: 2
            });
        });
    });
});