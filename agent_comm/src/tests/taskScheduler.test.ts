import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskScheduler, TaskSchedulerConfig } from '../services/taskScheduler';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { AgentCommunicationService } from '../services/agentCommunication';
import { ResourceLimits } from '../services/resourceManager';

describe('TaskScheduler', () => {
    let taskScheduler: TaskScheduler;
    let resourceManager: EnhancedResourceManager;
    let agentCommunication: AgentCommunicationService;

    const resourceLimits: ResourceLimits = {
        memory: {
            max: 8 * 1024 * 1024 * 1024,    // 8GB
            warning: 6 * 1024 * 1024 * 1024  // 6GB
        },
        cpu: {
            maxUsage: 80,
            warning: 60
        }
    };

    const schedulerConfig: TaskSchedulerConfig = {
        maxConcurrentTasks: 3,
        defaultMaxRetries: 3,
        retryDelayMs: 1000,
        taskTimeoutMs: 5000,
        resourceReservationTimeout: 10000
    };

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(resourceLimits);
        agentCommunication = new AgentCommunicationService(resourceManager);
        taskScheduler = new TaskScheduler(schedulerConfig, resourceManager, agentCommunication);
    });

    afterEach(() => {
        taskScheduler.stop();
        resourceManager.stop();
    });

    describe('Task Management', () => {
        it('should add new tasks', () => {
            const taskId = taskScheduler.addTask({
                id: 'task-1',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task).toBeDefined();
            expect(task?.status).toBe('pending');
        });

        it('should handle task priorities', async () => {
            const taskIds = [];
            const priorities = [1, 3, 2];

            for (let i = 0; i < 3; i++) {
                taskIds.push(taskScheduler.addTask({
                    id: `task-${i}`,
                    agentId: 'agent-1',
                    priority: priorities[i],
                    estimatedMemory: 1024 * 1024,
                    maxRetries: 3,
                    resourceRequirements: {
                        memory: 1024 * 1024,
                        cpu: 10
                    }
                }));
            }

            // Wait for tasks to start
            await new Promise(resolve => setTimeout(resolve, 200));

            const tasks = taskIds.map(id => taskScheduler.getTaskStatus(id));
            expect(tasks[1]?.status).toBe('running'); // Highest priority
        });

        it('should respect maxConcurrentTasks limit', async () => {
            const taskIds = [];
            for (let i = 0; i < 5; i++) {
                taskIds.push(taskScheduler.addTask({
                    id: `task-${i}`,
                    agentId: 'agent-1',
                    priority: 1,
                    estimatedMemory: 1024 * 1024,
                    maxRetries: 3,
                    resourceRequirements: {
                        memory: 1024 * 1024,
                        cpu: 10
                    }
                }));
            }

            // Wait for tasks to start
            await new Promise(resolve => setTimeout(resolve, 200));

            const runningTasks = taskIds
                .map(id => taskScheduler.getTaskStatus(id))
                .filter(task => task?.status === 'running');

            expect(runningTasks.length).toBeLessThanOrEqual(schedulerConfig.maxConcurrentTasks);
        });
    });

    describe('Resource Management', () => {
        it('should respect memory limits', async () => {
            const largeTaskId = taskScheduler.addTask({
                id: 'large-task',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 9 * 1024 * 1024 * 1024, // 9GB
                maxRetries: 3,
                resourceRequirements: {
                    memory: 9 * 1024 * 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task processing attempt
            await new Promise(resolve => setTimeout(resolve, 200));

            const task = taskScheduler.getTaskStatus(largeTaskId);
            expect(task?.status).toBe('pending');
        });

        it('should handle resource alerts', async () => {
            const taskId = taskScheduler.addTask({
                id: 'task-1',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task to start
            await new Promise(resolve => setTimeout(resolve, 200));

            // Simulate critical resource alert
            resourceManager.emit('alert', {
                type: 'memory',
                level: 'critical',
                message: 'Memory usage critical',
                value: 8 * 1024 * 1024 * 1024,
                threshold: 8 * 1024 * 1024 * 1024,
                timestamp: new Date()
            });

            // Wait for alert handling
            await new Promise(resolve => setTimeout(resolve, 200));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.status).not.toBe('running');
        });

        it('should release resources after task completion', async () => {
            const taskId = taskScheduler.addTask({
                id: 'resource-test',
                agentId: 'local',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task execution
            await new Promise(resolve => setTimeout(resolve, 200));

            const reservations = (resourceManager as any).resourceReservations;
            expect(reservations.has(taskId)).toBe(false);
        });
    });

    describe('Distributed Task Execution', () => {
        it('should execute task locally when preferred', async () => {
            const taskId = taskScheduler.addTask({
                id: 'local-task',
                agentId: 'local',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                distributionPreference: 'local',
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task execution
            await new Promise(resolve => setTimeout(resolve, 200));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.status).toBe('completed');
            expect(task?.agentId).toBe('local');
        });

        it('should distribute task to remote agent when appropriate', async () => {
            const mockAgent = {
                id: 'remote-1',
                capabilities: {
                    resourceCapacity: {
                        memory: 16 * 1024 * 1024 * 1024,
                        cpu: 100
                    }
                }
            };

            vi.spyOn(agentCommunication, 'findBestNodeForTask').mockReturnValue(mockAgent);
            vi.spyOn(agentCommunication, 'assignTask').mockResolvedValue(true);

            const taskId = taskScheduler.addTask({
                id: 'remote-task',
                agentId: 'pending',
                priority: 1,
                estimatedMemory: 10 * 1024 * 1024 * 1024, // Exceeds local capacity
                maxRetries: 3,
                distributionPreference: 'any',
                resourceRequirements: {
                    memory: 10 * 1024 * 1024 * 1024,
                    cpu: 90
                }
            });

            // Wait for task assignment
            await new Promise(resolve => setTimeout(resolve, 200));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.agentId).toBe('remote-1');
            expect(agentCommunication.assignTask).toHaveBeenCalled();
        });

        it('should handle remote task completion', async () => {
            const taskId = taskScheduler.addTask({
                id: 'remote-completion',
                agentId: 'remote-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                distributionPreference: 'remote',
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Simulate remote task completion
            agentCommunication.emit('task:status:updated', {
                taskId,
                payload: {
                    status: 'completed',
                    result: { success: true }
                }
            });

            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 100));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.status).toBe('completed');
        });

        it('should handle remote task failure and retry', async () => {
            const taskId = taskScheduler.addTask({
                id: 'remote-failure',
                agentId: 'remote-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                distributionPreference: 'remote',
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Simulate remote task failure
            agentCommunication.emit('task:status:updated', {
                taskId,
                payload: {
                    status: 'failed',
                    error: 'Task execution failed'
                }
            });

            // Wait for retry
            await new Promise(resolve => setTimeout(resolve, schedulerConfig.retryDelayMs + 100));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.retryCount).toBe(1);
            expect(task?.status).toBe('pending');
        });
    });

    describe('Error Handling', () => {
        it('should retry failed tasks', async () => {
            const retryHandler = vi.fn();
            taskScheduler.on('task:retry', retryHandler);

            const taskId = taskScheduler.addTask({
                id: 'failing-task',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 2,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for retry attempts
            await new Promise(resolve => setTimeout(resolve, 3000));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(retryHandler).toHaveBeenCalled();
            expect(task?.retryCount).toBeGreaterThan(0);
        });

        it('should handle task timeouts', async () => {
            const failureHandler = vi.fn();
            taskScheduler.on('task:failed', failureHandler);

            const taskId = taskScheduler.addTask({
                id: 'timeout-task',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 0,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task timeout
            await new Promise(resolve => setTimeout(resolve, 6000));

            const task = taskScheduler.getTaskStatus(taskId);
            expect(failureHandler).toHaveBeenCalled();
            expect(task?.status).toBe('failed');
            expect(task?.error?.message).toBe('Task timeout');
        });
    });

    describe('Task Dependencies', () => {
        it('should respect task dependencies', async () => {
            const task1Id = taskScheduler.addTask({
                id: 'task-1',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            const task2Id = taskScheduler.addTask({
                id: 'task-2',
                agentId: 'agent-1',
                priority: 2,
                estimatedMemory: 1024 * 1024,
                dependencies: [task1Id],
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task processing
            await new Promise(resolve => setTimeout(resolve, 200));

            const task2 = taskScheduler.getTaskStatus(task2Id);
            expect(task2?.status).toBe('pending');
        });
    });

    describe('Task Cancellation', () => {
        it('should cancel running tasks and release resources', async () => {
            const taskId = taskScheduler.addTask({
                id: 'task-1',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task to start
            await new Promise(resolve => setTimeout(resolve, 200));

            const cancelled = await taskScheduler.cancelTask(taskId);
            expect(cancelled).toBe(true);

            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.status).toBe('failed');
            expect(task?.error?.message).toBe('Task cancelled');

            const reservations = (resourceManager as any).resourceReservations;
            expect(reservations.has(taskId)).toBe(false);
        });

        it('should notify remote agent when cancelling remote task', async () => {
            const mockAgent = {
                id: 'remote-1',
                capabilities: {
                    resourceCapacity: {
                        memory: 16 * 1024 * 1024 * 1024,
                        cpu: 100
                    }
                }
            };

            vi.spyOn(agentCommunication, 'findBestNodeForTask').mockReturnValue(mockAgent);
            vi.spyOn(agentCommunication, 'assignTask').mockResolvedValue(true);
            const sendMessageSpy = vi.spyOn(agentCommunication, 'sendMessage').mockResolvedValue();

            const taskId = taskScheduler.addTask({
                id: 'remote-cancel-task',
                agentId: 'remote-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                distributionPreference: 'remote',
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task assignment
            await new Promise(resolve => setTimeout(resolve, 200));

            await taskScheduler.cancelTask(taskId);

            expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
                type: 'request',
                target: 'remote-1',
                payload: expect.objectContaining({
                    action: 'cancel',
                    taskId
                })
            }));
        });

        it('should not cancel completed tasks', async () => {
            const taskId = taskScheduler.addTask({
                id: 'task-1',
                agentId: 'agent-1',
                priority: 1,
                estimatedMemory: 1024 * 1024,
                maxRetries: 3,
                resourceRequirements: {
                    memory: 1024 * 1024,
                    cpu: 10
                }
            });

            // Wait for task completion
            await new Promise(resolve => setTimeout(resolve, 1000));

            const cancelled = await taskScheduler.cancelTask(taskId);
            expect(cancelled).toBe(false);
        });
    });
});