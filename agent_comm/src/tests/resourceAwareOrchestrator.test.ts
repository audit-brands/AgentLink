import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnhancedOrchestrator, Task, Agent } from '../services/enhancedOrchestrator';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { ResourceAwareTaskRouter } from '../services/resourceAwareTaskRouter';
import { ResourceLimits } from '../services/resourceManager';

describe('ResourceAwareOrchestrator', () => {
    let orchestrator: EnhancedOrchestrator;
    let resourceManager: EnhancedResourceManager;
    let taskRouter: ResourceAwareTaskRouter;

    const mockLimits: ResourceLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024, // 768MB
        },
        cpu: {
            maxUsage: 80, // 80%
            warning: 70, // 70%
        },
    };

    const mockTask: Omit<Task, 'status'> = {
        id: 'task-1',
        type: 'test',
        priority: 1,
        resourceRequirements: {
            memory: 256 * 1024 * 1024, // 256MB
            cpu: 20, // 20%
        },
    };

    const mockAgent: Agent = {
        id: 'agent-1',
        capabilities: ['test'],
        status: 'available',
        currentLoad: {
            memory: 128 * 1024 * 1024, // 128MB
            cpu: 10, // 10%
        },
    };

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(mockLimits);
        taskRouter = new ResourceAwareTaskRouter();
        orchestrator = new EnhancedOrchestrator(resourceManager, taskRouter);
    });

    describe('Task Submission', () => {
        it('should accept task when resources are available', async () => {
            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            
            const taskId = await orchestrator.submitTask(mockTask);
            expect(taskId).toBe(mockTask.id);
            expect(orchestrator.getTaskStatus(taskId)).toBe('pending');
        });

        it('should reject task when resources are insufficient', async () => {
            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(false);
            
            await expect(orchestrator.submitTask(mockTask))
                .rejects.toThrow('Insufficient resources');
        });
    });

    describe('Agent Management', () => {
        it('should register new agent', () => {
            orchestrator.registerAgent(mockAgent);
            expect(orchestrator.getAgentStatus(mockAgent.id)).toBe('available');
        });

        it('should deregister agent', () => {
            orchestrator.registerAgent(mockAgent);
            orchestrator.deregisterAgent(mockAgent.id);
            expect(orchestrator.getAgentStatus(mockAgent.id)).toBeUndefined();
        });
    });

    describe('Task Routing', () => {
        it('should route task to available agent', async () => {
            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 0,
                    free: mockLimits.memory.max,
                    processUsage: 0,
                    heapUsage: 0
                },
                cpu: {
                    usage: 0,
                    loadAvg: [0, 0, 0],
                    processUsage: 0
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max,
                    cpu: mockLimits.cpu.maxUsage
                },
                utilizationPercentages: {
                    memory: 0,
                    cpu: 0
                }
            });

            orchestrator.registerAgent(mockAgent);
            const taskId = await orchestrator.submitTask(mockTask);

            // Wait for task routing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(orchestrator.getTaskStatus(taskId)).toBe('assigned');
        });
    });

    describe('System Metrics', () => {
        it('should return comprehensive system metrics', async () => {
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 0,
                    free: mockLimits.memory.max,
                    processUsage: 0,
                    heapUsage: 0
                },
                cpu: {
                    usage: 0,
                    loadAvg: [0, 0, 0],
                    processUsage: 0
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max,
                    cpu: mockLimits.cpu.maxUsage
                },
                utilizationPercentages: {
                    memory: 0,
                    cpu: 0
                }
            });

            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 0,
                cpu: 0
            });

            orchestrator.registerAgent(mockAgent);
            const metrics = await orchestrator.getSystemMetrics();

            expect(metrics).toHaveProperty('resources');
            expect(metrics).toHaveProperty('utilization');
            expect(metrics).toHaveProperty('activeTaskCount');
            expect(metrics).toHaveProperty('availableAgents');
            expect(metrics).toHaveProperty('totalAgents');
            expect(metrics.totalAgents).toBe(1);
        });
    });

    describe('Event Handling', () => {
        it('should emit events on task status changes', async () => {
            const statusUpdateSpy = vi.fn();
            orchestrator.on('task:status_updated', statusUpdateSpy);

            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            orchestrator.registerAgent(mockAgent);
            await orchestrator.submitTask(mockTask);

            expect(statusUpdateSpy).toHaveBeenCalled();
        });

        it('should handle task completion', async () => {
            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            orchestrator.registerAgent(mockAgent);
            const taskId = await orchestrator.submitTask(mockTask);

            taskRouter.emit('task:completed', taskId);
            expect(orchestrator.getTaskStatus(taskId)).toBe('completed');
        });

        it('should handle task failure', async () => {
            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            orchestrator.registerAgent(mockAgent);
            const taskId = await orchestrator.submitTask(mockTask);

            const error = new Error('Test error');
            taskRouter.emit('task:failed', taskId, error);
            expect(orchestrator.getTaskStatus(taskId)).toBe('failed');
        });
    });
});