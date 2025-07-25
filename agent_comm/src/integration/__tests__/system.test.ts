import { TaskScheduler, Task, TaskSchedulerConfig } from '../../services/taskScheduler';
import { EnhancedResourceManager, ResourceLimits } from '../../services/enhancedResourceManager';
import { SystemMonitor, AlertConfig } from '../../services/monitoring/systemMonitor';
import { EventEmitter } from 'events';
import os from 'os';

describe('System Integration Tests', () => {
    let taskScheduler: TaskScheduler;
    let resourceManager: EnhancedResourceManager;
    let systemMonitor: SystemMonitor;
    let eventEmitter: EventEmitter;

    beforeEach(() => {
        // Initialize components
        const resourceLimits: ResourceLimits = {
            memory: {
                max: 90,
                warning: 80
            },
            cpu: {
                maxUsage: 90,
                warning: 80
            }
        };

        const schedulerConfig: TaskSchedulerConfig = {
            maxConcurrentTasks: 2,
            taskTimeoutMs: 1000,
            maxRetries: 3
        };

        const monitorConfig: AlertConfig = {
            memory: {
                warning: 80,
                critical: 90
            },
            cpu: {
                warning: 80,
                critical: 90
            },
            healthCheck: {
                interval: 1000,
                timeout: 5000
            }
        };

        eventEmitter = new EventEmitter();
        resourceManager = new EnhancedResourceManager(resourceLimits);
        taskScheduler = new TaskScheduler(schedulerConfig, resourceManager, eventEmitter);
        systemMonitor = new SystemMonitor(resourceManager, monitorConfig);

        // Mock resource manager methods to allow task execution
        jest.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
        jest.spyOn(resourceManager, 'reserveResources').mockResolvedValue(true);
        jest.spyOn(resourceManager, 'releaseResources').mockImplementation(() => {});
    });

    afterEach(() => {
        systemMonitor.stop();
        resourceManager.stop();
        jest.clearAllMocks();
    });

    describe('Task Execution with Resource Monitoring', () => {
        it('should execute tasks and reflect resource usage in monitoring', async () => {
            const metricsPromise = new Promise(resolve => {
                systemMonitor.on('metrics', (metrics) => {
                    resolve(metrics);
                });
            });

            const task: Task = {
                id: '1',
                execute: jest.fn().mockResolvedValue('success'),
                requiredResources: {
                    memory: 1000,
                    cpu: 20
                }
            };

            // Add and execute task
            taskScheduler.addTask(task);
            await taskScheduler.executeTask('1');

            // Wait for metrics update
            const metrics = await metricsPromise;
            expect(metrics).toHaveProperty('utilizationPercentages');
        });

        it('should trigger alerts when resource usage is high', async () => {
            // Mock getEnhancedMetrics to return high memory usage
            jest.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: 16000000000, // 16GB
                    used: 14000000000,  // 14GB
                    free: 2000000000,   // 2GB
                    processUsage: 1000000000,
                    heapUsage: 500000000
                },
                cpu: {
                    usage: 50,
                    loadAvg: [2, 2, 2],
                    processUsage: 20
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: 2000000000,
                    cpu: 50
                },
                utilizationPercentages: {
                    memory: 85, // High memory usage
                    cpu: 50
                },
                clusterMetrics: {
                    totalMemory: 16000000000,
                    totalCpu: 100,
                    availableMemory: 2000000000,
                    availableCpu: 50,
                    nodeCount: 1,
                    activeNodes: 1
                }
            });

            // Mock emit to capture alerts
            const mockEmit = jest.fn();
            systemMonitor.emit = mockEmit;

            // Trigger a health check manually
            await systemMonitor['performHealthCheck']();

            // Verify that a memory warning alert was emitted
            expect(mockEmit).toHaveBeenCalledWith(
                'health',
                expect.objectContaining({
                    checks: expect.objectContaining({
                        memory: expect.objectContaining({
                            status: 'warn'
                        })
                    })
                })
            );
        });

        it('should maintain system health status during task execution', async () => {
            const task1: Task = {
                id: '1',
                execute: jest.fn().mockResolvedValue('success'),
                requiredResources: {
                    memory: 1000,
                    cpu: 20
                }
            };

            const task2: Task = {
                id: '2',
                execute: jest.fn().mockResolvedValue('success'),
                requiredResources: {
                    memory: 1000,
                    cpu: 20
                }
            };

            // Execute tasks concurrently
            taskScheduler.addTask(task1);
            taskScheduler.addTask(task2);
            await Promise.all([
                taskScheduler.executeTask('1'),
                taskScheduler.executeTask('2')
            ]);

            const healthStatus = systemMonitor.getHealthStatus();
            expect(healthStatus.status).toBe('healthy');
            expect(healthStatus.checks).toHaveProperty('memory');
            expect(healthStatus.checks).toHaveProperty('cpu');
        });
    });

    describe('Resource Management Integration', () => {
        it('should properly release resources after task completion', async () => {
            const task: Task = {
                id: '1',
                execute: jest.fn().mockResolvedValue('success'),
                requiredResources: {
                    memory: 1000,
                    cpu: 20
                }
            };

            // Execute task
            taskScheduler.addTask(task);
            await taskScheduler.executeTask('1');

            // Check resource utilization after task completion
            const utilization = resourceManager.getResourceUtilization();
            expect(utilization.memory).toBe(0);
            expect(utilization.cpu).toBe(0);
        });

        it('should handle multiple tasks with resource constraints', async () => {
            const tasks = Array.from({ length: 3 }, (_, i) => ({
                id: `task-${i + 1}`,
                execute: jest.fn().mockResolvedValue('success'),
                requiredResources: {
                    memory: 1000,
                    cpu: 30
                }
            }));

            // Add all tasks
            tasks.forEach(task => taskScheduler.addTask(task));

            // Try to execute all tasks simultaneously
            const executions = tasks.map(task => taskScheduler.executeTask(task.id));
            
            // Only maxConcurrentTasks should execute at once
            await expect(Promise.all(executions)).rejects.toThrow('Maximum concurrent tasks limit reached');
        });
    });

    describe('System Monitoring Integration', () => {
        it('should track task execution in metrics history', async () => {
            const task: Task = {
                id: '1',
                execute: jest.fn().mockImplementation(async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return 'success';
                }),
                requiredResources: {
                    memory: 1000,
                    cpu: 20
                }
            };

            // Execute task
            taskScheduler.addTask(task);
            await taskScheduler.executeTask('1');

            // Check metrics history
            const history = systemMonitor.getMetricsHistory(1000); // Last second
            expect(history.length).toBeGreaterThan(0);
        });

        it('should maintain accurate health status during high load', async () => {
            const tasks = Array.from({ length: 5 }, (_, i) => ({
                id: `task-${i + 1}`,
                execute: jest.fn().mockImplementation(async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    return 'success';
                }),
                requiredResources: {
                    memory: 500,
                    cpu: 15
                }
            }));

            // Add all tasks
            tasks.forEach(task => taskScheduler.addTask(task));

            // Execute tasks sequentially
            for (const task of tasks) {
                try {
                    await taskScheduler.executeTask(task.id);
                } catch (error) {
                    // Ignore concurrent execution errors
                }
            }

            const healthStatus = systemMonitor.getHealthStatus();
            expect(healthStatus).toHaveProperty('status');
            expect(healthStatus.checks).toHaveProperty('memory');
            expect(healthStatus.checks).toHaveProperty('cpu');
        });
    });
});