import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkflowEngine } from '../services/workflowEngine';
import { WorkflowStatus, WorkflowDefinition, WorkflowPriority } from '../types/workflow';
import { TaskScheduler } from '../services/taskScheduler';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';

describe('WorkflowEngine Phase 4.1', () => {
    let workflowEngine: WorkflowEngine;
    let mockWorkflow: WorkflowDefinition;
    let resourceManager: EnhancedResourceManager;
    let taskScheduler: TaskScheduler;

    const resourceLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024 // 768MB
        },
        cpu: {
            maxUsage: 80,
            warning: 70
        }
    };

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(resourceLimits);
        taskScheduler = new TaskScheduler({
            maxConcurrentTasks: 5,
            defaultMaxRetries: 3,
            retryDelayMs: 1000,
            taskTimeoutMs: 5000
        }, resourceManager);

        // Mock resource manager methods
        vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
            memory: {
                total: 1024 * 1024 * 1024,
                used: 512 * 1024 * 1024,
                free: 512 * 1024 * 1024,
                processUsage: 512 * 1024 * 1024,
                heapUsage: 512 * 1024 * 1024
            },
            cpu: {
                usage: 50,
                loadAvg: [50, 50, 50],
                processUsage: 50
            },
            storage: {
                used: 0,
                free: 1000
            },
            availableResources: {
                memory: 512 * 1024 * 1024,
                cpu: 30
            },
            utilizationPercentages: {
                memory: 50,
                cpu: 50
            },
            clusterMetrics: {
                totalMemory: 4 * 1024 * 1024 * 1024,
                totalCpu: 400,
                availableMemory: 3 * 1024 * 1024 * 1024,
                availableCpu: 300,
                nodeCount: 4,
                activeNodes: 4
            }
        });

        vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
            memory: 50,
            cpu: 50
        });

        workflowEngine = new WorkflowEngine(resourceManager, taskScheduler);
        
        // Create a mock workflow with distributed steps
        mockWorkflow = {
            name: 'Test Workflow',
            description: 'Test workflow for distributed execution',
            version: '1.0',
            steps: [
                {
                    id: 'local-step',
                    name: 'Local Step',
                    execute: vi.fn().mockResolvedValue('local result'),
                    outputVariable: 'localOutput'
                },
                {
                    id: 'distributed-step',
                    name: 'Distributed Step',
                    execute: vi.fn().mockResolvedValue('distributed result'),
                    resourceRequirements: {
                        memory: 256 * 1024 * 1024,
                        cpu: 20,
                        priority: WorkflowPriority.NORMAL
                    },
                    outputVariable: 'distributedOutput'
                },
                {
                    id: 'conditional-step',
                    name: 'Conditional Step',
                    condition: async (vars) => vars.distributedOutput === 'distributed result',
                    execute: vi.fn().mockResolvedValue('conditional result'),
                    resourceRequirements: {
                        memory: 128 * 1024 * 1024,
                        cpu: 10
                    }
                }
            ],
            maxConcurrentSteps: 2,
            rollbackOnError: true,
            variables: {}
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Distributed Workflow Execution', () => {
        it('should execute mixed local and distributed steps', async () => {
            // Mock task scheduler methods
            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            const executionPromise = workflowEngine.startWorkflow(workflowId);

            // Simulate distributed task completion
            setTimeout(() => {
                taskScheduler.emit('task:completed', {
                    id: 'distributed-step',
                    result: 'distributed result'
                });
            }, 100);

            await executionPromise;
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
            expect(mockWorkflow.steps[0].execute).toHaveBeenCalled();
            expect(taskScheduler.addTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'distributed-step',
                    resourceRequirements: {
                        memory: 256 * 1024 * 1024,
                        cpu: 20
                    }
                })
            );
        });

        it('should handle parallel distributed execution', async () => {
            const parallelWorkflow: WorkflowDefinition = {
                name: 'Parallel Workflow',
                version: '1.0',
                maxConcurrentSteps: 2,
                steps: [
                    {
                        id: 'parallel-1',
                        name: 'Parallel Step 1',
                        execute: vi.fn().mockResolvedValue('result-1'),
                        resourceRequirements: {
                            memory: 128 * 1024 * 1024,
                            cpu: 10
                        }
                    },
                    {
                        id: 'parallel-2',
                        name: 'Parallel Step 2',
                        execute: vi.fn().mockResolvedValue('result-2'),
                        resourceRequirements: {
                            memory: 128 * 1024 * 1024,
                            cpu: 10
                        }
                    }
                ]
            };

            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(parallelWorkflow);
            const executionPromise = workflowEngine.startWorkflow(workflowId);

            // Simulate parallel task completions
            setTimeout(() => {
                taskScheduler.emit('task:completed', {
                    id: 'parallel-1',
                    result: 'result-1'
                });
                taskScheduler.emit('task:completed', {
                    id: 'parallel-2',
                    result: 'result-2'
                });
            }, 100);

            await executionPromise;
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
            expect(taskScheduler.addTask).toHaveBeenCalledTimes(2);
        });

        it('should handle distributed step failures and retries', async () => {
            const retryWorkflow: WorkflowDefinition = {
                name: 'Retry Workflow',
                version: '1.0',
                steps: [
                    {
                        id: 'retry-step',
                        name: 'Retry Step',
                        execute: vi.fn().mockResolvedValue('retry result'),
                        resourceRequirements: {
                            memory: 256 * 1024 * 1024,
                            cpu: 20
                        },
                        retryPolicy: {
                            maxAttempts: 3,
                            backoffMultiplier: 2,
                            maxDelay: 1000
                        }
                    }
                ]
            };

            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(retryWorkflow);
            const retryHandler = vi.fn();
            workflowEngine.on('workflow:step:retrying', retryHandler);

            const executionPromise = workflowEngine.startWorkflow(workflowId);

            // Simulate task failure and eventual success
            setTimeout(() => {
                taskScheduler.emit('task:failed', {
                    id: 'retry-step',
                    error: new Error('Task failed')
                });
                
                // Simulate success on retry
                setTimeout(() => {
                    taskScheduler.emit('task:completed', {
                        id: 'retry-step',
                        result: 'retry result'
                    });
                }, 100);
            }, 100);

            await executionPromise;
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
            expect(retryHandler).toHaveBeenCalled();
            expect(taskScheduler.addTask).toHaveBeenCalledTimes(2);
        });
    });

    describe('Resource Management', () => {
        it('should respect resource limits', async () => {
            const highResourceWorkflow: WorkflowDefinition = {
                name: 'Resource Test',
                version: '1.0',
                steps: [
                    {
                        id: 'high-resource-step',
                        name: 'High Resource Step',
                        execute: vi.fn().mockResolvedValue('result'),
                        resourceRequirements: {
                            memory: 2 * 1024 * 1024 * 1024, // 2GB
                            cpu: 90
                        }
                    }
                ]
            };

            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(false);

            const workflowId = workflowEngine.createWorkflow(highResourceWorkflow);
            await workflowEngine.startWorkflow(workflowId);
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).not.toBe(WorkflowStatus.COMPLETED);
            expect(taskScheduler.canExecuteTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceRequirements: {
                        memory: 2 * 1024 * 1024 * 1024,
                        cpu: 90
                    }
                })
            );
        });

        it('should handle resource critical events', async () => {
            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);
            vi.spyOn(taskScheduler, 'cancelTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            const executionPromise = workflowEngine.startWorkflow(workflowId);

            // Simulate resource critical event
            resourceManager.emit('alert', {
                type: 'memory',
                level: 'critical',
                message: 'Memory usage critical',
                value: 900 * 1024 * 1024,
                threshold: 1024 * 1024 * 1024,
                timestamp: new Date()
            });

            await executionPromise.catch(() => {});
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.FAILED);
            expect(taskScheduler.cancelTask).toHaveBeenCalled();
        });
    });

    describe('Workflow Control with Distributed Steps', () => {
        it('should cancel distributed steps on workflow cancellation', async () => {
            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);
            vi.spyOn(taskScheduler, 'cancelTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            const executionPromise = workflowEngine.startWorkflow(workflowId);

            // Wait for tasks to start
            await new Promise(resolve => setTimeout(resolve, 100));

            await workflowEngine.cancelWorkflow(workflowId);
            await executionPromise.catch(() => {});

            expect(taskScheduler.cancelTask).toHaveBeenCalled();
            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.CANCELLED);
        });

        it('should pause and resume distributed execution', async () => {
            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            const executionPromise = workflowEngine.startWorkflow(workflowId);

            // Wait for tasks to start
            await new Promise(resolve => setTimeout(resolve, 100));

            await workflowEngine.pauseWorkflow(workflowId);
            let status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.PAUSED);

            const resumePromise = workflowEngine.resumeWorkflow(workflowId);

            // Simulate task completion after resume
            setTimeout(() => {
                taskScheduler.emit('task:completed', {
                    id: 'distributed-step',
                    result: 'distributed result'
                });
            }, 100);

            await resumePromise;
            status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });
    });

    describe('Metrics and Monitoring', () => {
        it('should track distributed execution metrics', async () => {
            vi.spyOn(taskScheduler, 'addTask').mockImplementation((task) => task.id);
            vi.spyOn(taskScheduler, 'canExecuteTask').mockResolvedValue(true);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            const executionPromise = workflowEngine.startWorkflow(workflowId);

            setTimeout(() => {
                taskScheduler.emit('task:completed', {
                    id: 'distributed-step',
                    result: 'distributed result'
                });
            }, 100);

            await executionPromise;
            const metrics = workflowEngine.getWorkflowMetrics(workflowId);

            expect(metrics).toBeDefined();
            expect(metrics?.resourceUtilization).toBeDefined();
            expect(metrics?.resourceUtilization.cpu).toBeDefined();
            expect(metrics?.resourceUtilization.memory).toBeDefined();
        });
    });
});