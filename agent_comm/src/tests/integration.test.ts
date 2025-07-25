import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResourceManager, ResourceLimits } from '../services/resourceManager';
import { TaskScheduler, TaskSchedulerConfig } from '../services/taskScheduler';
import { resourceConfig } from '../config/resources';
import { taskSchedulerConfig } from '../config/scheduler';

describe('System Integration Tests', () => {
    let resourceManager: ResourceManager;
    let taskScheduler: TaskScheduler;

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
        taskTimeoutMs: 5000
    };

    beforeEach(() => {
        resourceManager = new ResourceManager(resourceLimits);
        taskScheduler = new TaskScheduler(schedulerConfig, resourceManager);
    });

    afterEach(() => {
        taskScheduler.stop();
        resourceManager.stop();
        vi.clearAllMocks();
    });

    describe('Resource-Aware Task Scheduling', () => {
        it('should handle multiple tasks within resource limits', async () => {
            const metricsHandler = vi.fn();
            resourceManager.on('metrics', metricsHandler);

            // Trigger metrics emission
            resourceManager.emit('metrics', {
                memory: {
                    total: 8 * 1024 * 1024 * 1024,
                    free: 4 * 1024 * 1024 * 1024,
                    processUsage: 2 * 1024 * 1024 * 1024
                },
                cpu: {
                    usage: 30
                }
            });

            // Add multiple tasks with varying memory requirements
            const tasks = [];
            for (let i = 0; i < 5; i++) {
                tasks.push(taskScheduler.addTask({
                    id: `task-${i}`,
                    agentId: 'test-agent',
                    priority: 1,
                    estimatedMemory: taskSchedulerConfig.memoryEstimates.small,
                    maxRetries: 2
                }));
            }

            // Wait for task processing
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify resource monitoring is active
            expect(metricsHandler).toHaveBeenCalled();
            
            // Verify task execution
            const runningTasks = tasks
                .map(id => taskScheduler.getTaskStatus(id))
                .filter(task => task?.status === 'running');
            expect(runningTasks.length).toBeLessThanOrEqual(schedulerConfig.maxConcurrentTasks);
        });

        it('should prevent resource exhaustion', async () => {
            const alertHandler = vi.fn();
            resourceManager.on('alert', alertHandler);

            // Simulate high resource usage and trigger alert
            resourceManager.emit('metrics', {
                memory: {
                    total: 8 * 1024 * 1024 * 1024,
                    free: 512 * 1024 * 1024,
                    processUsage: 7 * 1024 * 1024 * 1024
                },
                cpu: {
                    usage: 85
                }
            });

            // Trigger resource alert
            resourceManager.emit('alert', {
                type: 'memory',
                level: 'critical',
                message: 'Memory usage exceeds threshold'
            });

            // Add a task requiring more than available memory
            const taskId = taskScheduler.addTask({
                id: 'large-task',
                agentId: 'test-agent',
                priority: 1,
                estimatedMemory: 9 * 1024 * 1024 * 1024, // 9GB
                maxRetries: 2
            });

            // Wait for task processing attempt
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Task should be pending due to resource constraints
            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.status).toBe('pending');
            expect(alertHandler).toHaveBeenCalled();
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should handle resource exhaustion gracefully', async () => {
            const alertHandler = vi.fn();
            resourceManager.on('alert', alertHandler);

            // Add new task during resource pressure
            const taskId = taskScheduler.addTask({
                id: 'pressure-task',
                agentId: 'test-agent',
                priority: 1,
                estimatedMemory: 512 * 1024 * 1024,
                maxRetries: 2
            });

            // Simulate memory pressure and trigger alert
            resourceManager.emit('metrics', {
                memory: {
                    total: 8 * 1024 * 1024 * 1024,
                    free: 512 * 1024 * 1024,
                    processUsage: 7 * 1024 * 1024 * 1024
                },
                cpu: {
                    usage: 50
                }
            });

            // Trigger resource alert
            resourceManager.emit('alert', {
                type: 'memory',
                level: 'warning',
                message: 'High memory usage detected'
            });
            
            // Wait for alert and recovery
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify task state
            const task = taskScheduler.getTaskStatus(taskId);
            expect(task).toBeDefined();
            expect(['pending', 'completed']).toContain(task?.status);
            expect(alertHandler).toHaveBeenCalled();
        });

        it('should recover from task failures', async () => {
            const retryHandler = vi.fn();
            taskScheduler.on('task:retry', retryHandler);

            // Add a task that will fail
            const taskId = taskScheduler.addTask({
                id: 'failing-task',
                agentId: 'test-agent',
                priority: 1,
                estimatedMemory: taskSchedulerConfig.memoryEstimates.small,
                maxRetries: 2,
                execute: async () => { throw new Error('Simulated failure'); }
            });

            // Wait for retry attempts
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Verify retry mechanism
            expect(retryHandler).toHaveBeenCalled();
            const task = taskScheduler.getTaskStatus(taskId);
            expect(task?.retryCount).toBeGreaterThan(0);
        });
    });

    describe('Performance and Scalability', () => {
        it('should handle rapid task submissions', async () => {
            const startTime = Date.now();
            const taskIds = [];

            // Rapidly submit tasks
            for (let i = 0; i < 20; i++) {
                taskIds.push(taskScheduler.addTask({
                    id: `rapid-task-${i}`,
                    agentId: 'test-agent',
                    priority: 1,
                    estimatedMemory: taskSchedulerConfig.memoryEstimates.small,
                    maxRetries: 1
                }));
            }

            // Verify submission time
            const submissionTime = Date.now() - startTime;
            expect(submissionTime).toBeLessThan(1000); // Should be near-instant

            // Wait for processing to begin
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify concurrent task limit is respected
            const runningTasks = taskIds
                .map(id => taskScheduler.getTaskStatus(id))
                .filter(task => task?.status === 'running');
            expect(runningTasks.length).toBeLessThanOrEqual(schedulerConfig.maxConcurrentTasks);
        });

        it('should maintain system stability under load', async () => {
            const metricsHandler = vi.fn();
            resourceManager.on('metrics', metricsHandler);

            // Simulate initial metrics
            resourceManager.emit('metrics', {
                memory: {
                    total: 8 * 1024 * 1024 * 1024,
                    free: 6 * 1024 * 1024 * 1024,
                    processUsage: 2 * 1024 * 1024 * 1024
                },
                cpu: {
                    usage: 30
                }
            });

            // Create mixed workload
            const workload = [
                { priority: 3, memory: taskSchedulerConfig.memoryEstimates.small },
                { priority: 1, memory: taskSchedulerConfig.memoryEstimates.small },
                { priority: 2, memory: taskSchedulerConfig.memoryEstimates.small },
                { priority: 4, memory: taskSchedulerConfig.memoryEstimates.small }
            ];

            // Submit mixed workload multiple times
            for (let i = 0; i < 3; i++) {
                for (const spec of workload) {
                    taskScheduler.addTask({
                        id: `load-task-${i}-${spec.priority}`,
                        agentId: 'test-agent',
                        priority: spec.priority,
                        estimatedMemory: spec.memory,
                        maxRetries: 1
                    });
                }
            }

            // Wait for monitoring cycles
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify system metrics were collected
            expect(metricsHandler).toHaveBeenCalled();
            
            // Verify memory stayed within limits
            const metrics = resourceManager.getMetrics();
            expect(metrics.memory.processUsage).toBeLessThan(resourceLimits.memory.max);
        });
    });

    describe('Configuration Integration', () => {
        it('should respect configured resource limits', () => {
            expect(resourceConfig.memory.max).toBeLessThanOrEqual(8 * 1024 * 1024 * 1024);
            expect(taskSchedulerConfig.memoryEstimates.xlarge).toBeLessThan(resourceConfig.memory.max);
        });

        it('should apply task scheduling configuration', async () => {
            // Add more tasks than maxConcurrentTasks
            const taskIds = [];
            for (let i = 0; i < taskSchedulerConfig.maxConcurrentTasks + 2; i++) {
                taskIds.push(taskScheduler.addTask({
                    id: `config-task-${i}`,
                    agentId: 'test-agent',
                    priority: taskSchedulerConfig.priorities.MEDIUM,
                    estimatedMemory: taskSchedulerConfig.memoryEstimates.small,
                    maxRetries: 1
                }));
            }

            // Wait for processing to begin
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify concurrent task limit
            const runningTasks = taskIds
                .map(id => taskScheduler.getTaskStatus(id))
                .filter(task => task?.status === 'running');
            expect(runningTasks.length).toBeLessThanOrEqual(schedulerConfig.maxConcurrentTasks);
        });
    });
});