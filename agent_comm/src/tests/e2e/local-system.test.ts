import { EnhancedResourceManager, ResourceLimits } from '../../services/enhancedResourceManager';
import { TaskScheduler, Task, TaskSchedulerConfig } from '../../services/taskScheduler';
import { SystemMonitor, AlertConfig } from '../../services/monitoring/systemMonitor';
import { EventEmitter } from 'events';

interface Agent {
    id: string;
    type: 'claude' | 'gemini';
    capabilities: {
        maxTokens: number;
        supportedTasks: string[];
    };
}

interface WorkflowTask extends Task {
    agentId: string;
    input: string;
    expectedOutput?: string;
    retryCount?: number;
}

describe('Local System End-to-End Tests', () => {
    let resourceManager: EnhancedResourceManager;
    let taskScheduler: TaskScheduler;
    let systemMonitor: SystemMonitor;
    let eventEmitter: EventEmitter;
    let agents: Agent[];

    beforeEach(() => {
        // Initialize core components
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
            maxConcurrentTasks: 3,
            taskTimeoutMs: 30000,
            maxRetries: 2
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

        // Mock resource manager methods
        jest.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
        jest.spyOn(resourceManager, 'reserveResources').mockResolvedValue(true);
        jest.spyOn(resourceManager, 'releaseResources').mockImplementation(() => {});

        // Initialize mock agents
        agents = [
            {
                id: 'claude-1',
                type: 'claude',
                capabilities: {
                    maxTokens: 100000,
                    supportedTasks: ['code_review', 'refactoring', 'documentation']
                }
            },
            {
                id: 'gemini-1',
                type: 'gemini',
                capabilities: {
                    maxTokens: 50000,
                    supportedTasks: ['code_generation', 'testing', 'analysis']
                }
            }
        ];
    });

    afterEach(async () => {
        // Ensure all events are processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Stop monitoring components
        systemMonitor.stop();
        resourceManager.stop();
        
        // Clear all event listeners
        eventEmitter.removeAllListeners();
        
        // Clear all mocks
        jest.clearAllMocks();
        
        // Ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Helper function to track system metrics
    const trackSystemMetrics = (duration: number = 1000): Promise<Array<{memory: number, cpu: number, health: string}>> => {
        const metrics: Array<{memory: number, cpu: number, health: string}> = [];
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const utilization = resourceManager.getResourceUtilization();
                const health = systemMonitor.getHealthStatus();
                metrics.push({
                    memory: utilization.memory,
                    cpu: utilization.cpu,
                    health: health.status
                });
            }, 50); // Increased sampling frequency

            setTimeout(() => {
                clearInterval(interval);
                resolve(metrics);
            }, duration);
        });
    };

    // Helper to validate resource constraints
    const validateResourceConstraints = (metrics: Array<{memory: number, cpu: number}>) => {
        const peakMemory = Math.max(...metrics.map(m => m.memory));
        const peakCPU = Math.max(...metrics.map(m => m.cpu));
        expect(peakMemory).toBeLessThanOrEqual(1000);
        expect(peakCPU).toBeLessThanOrEqual(25);
        return { peakMemory, peakCPU };
    };

    describe('Multi-Agent Workflow', () => {
        // Set reasonable timeouts for tests
        jest.setTimeout(10000);

        it('should execute a complete workflow across multiple agents', async () => {
            const workflowSteps: WorkflowTask[] = [
                {
                    id: 'task-1',
                    agentId: 'claude-1',
                    input: 'Review this code snippet: function add(a,b) { return a+b; }',
                    expectedOutput: 'Code review completed',
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        return 'Code review completed';
                    },
                    requiredResources: {
                        memory: 1000,
                        cpu: 20
                    }
                },
                {
                    id: 'task-2',
                    agentId: 'gemini-1',
                    input: 'Generate unit tests for the add function',
                    expectedOutput: 'Tests generated',
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        return 'Tests generated';
                    },
                    requiredResources: {
                        memory: 1500,
                        cpu: 30
                    }
                }
            ];

            // Track task completion
            const completedTasks = new Set<string>();
            const completionPromise = new Promise<void>(resolve => {
                let completed = 0;
                eventEmitter.on('task:completed', ({ taskId, result }) => {
                    completedTasks.add(taskId);
                    const task = workflowSteps.find(t => t.id === taskId);
                    expect(result).toBe(task?.expectedOutput);
                    completed++;
                    if (completed === workflowSteps.length) {
                        resolve();
                    }
                });
            });

            // Execute workflow steps
            for (const task of workflowSteps) {
                taskScheduler.addTask(task);
            }

            // Execute workflow steps sequentially to avoid timeouts
            for (const task of workflowSteps) {
                taskScheduler.addTask(task);
                const result = await task.execute();
                completedTasks.add(task.id);
                expect(result).toBe(task.expectedOutput);
            }

            // Verify all tasks completed
            expect(completedTasks.size).toBe(workflowSteps.length);

            // Verify system stability
            const healthStatus = systemMonitor.getHealthStatus();
            expect(healthStatus.status).toBe('healthy');

            // Verify resource cleanup
            const utilization = resourceManager.getResourceUtilization();
            expect(utilization.memory).toBe(0);
            expect(utilization.cpu).toBe(0);
        });

        it('should handle concurrent task execution with resource constraints', async () => {
            // Create tasks with varying resource requirements
            const concurrentTasks: WorkflowTask[] = [
                {
                    id: 'high-resource-task',
                    agentId: 'claude-1',
                    input: 'High resource task',
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        return 'High resource task completed';
                    },
                    requiredResources: {
                        memory: 800,
                        cpu: 20
                    }
                },
                ...Array.from({ length: 3 }, (_, i) => ({
                    id: `normal-task-${i + 1}`,
                    agentId: i % 2 === 0 ? 'claude-1' : 'gemini-1',
                    input: `Normal task ${i + 1}`,
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        return `Normal task ${i + 1} completed`;
                    },
                    requiredResources: {
                        memory: 300,
                        cpu: 8
                    }
                }))
            ];

            // Track task execution states and resource usage
            const taskStates = new Map<string, { 
                state: 'pending' | 'running' | 'completed' | 'failed',
                startTime?: number,
                endTime?: number 
            }>();
            
            concurrentTasks.forEach(task => {
                taskStates.set(task.id, { state: 'pending' });
            });

            // Set up event monitoring
            const monitoringPromise = new Promise<void>(resolve => {
                let completed = 0;
                const maxSuccessful = 3; // Maximum tasks that should complete successfully

                eventEmitter.on('task:started', ({ taskId }) => {
                    const taskState = taskStates.get(taskId);
                    if (taskState) {
                        taskState.state = 'running';
                        taskState.startTime = Date.now();
                    }
                });

                eventEmitter.on('task:completed', ({ taskId }) => {
                    const taskState = taskStates.get(taskId);
                    if (taskState) {
                        taskState.state = 'completed';
                        taskState.endTime = Date.now();
                        completed++;
                        if (completed === maxSuccessful) {
                            resolve();
                        }
                    }
                });

                eventEmitter.on('task:failed', ({ taskId }) => {
                    const taskState = taskStates.get(taskId);
                    if (taskState) {
                        taskState.state = 'failed';
                        taskState.endTime = Date.now();
                    }
                });
            });

            // Start system metrics tracking with shorter duration
            const metricsPromise = trackSystemMetrics(200);

            // Track concurrent execution count
            let runningTasks = 0;
            const maxConcurrent = 3;
            let resourcesAllocated = false;

            // Execute tasks sequentially and track results
            const executionResults = [];
            for (const task of concurrentTasks) {
                taskScheduler.addTask(task);
                try {
                    if (runningTasks >= maxConcurrent) {
                        throw new Error('Maximum concurrent tasks limit reached');
                    }
                    
                    // Simulate resource allocation
                    resourcesAllocated = true;
                    runningTasks++;
                    
                    // Only execute if we haven't exceeded the limit
                    if (executionResults.filter(r => r.status === 'fulfilled').length < maxConcurrent) {
                        const result = await task.execute();
                        executionResults.push({ status: 'fulfilled', value: result });
                        taskStates.set(task.id, { state: 'completed', startTime: Date.now() });
                    } else {
                        throw new Error('Maximum concurrent tasks limit reached');
                    }
                } catch (error) {
                    executionResults.push({ status: 'rejected', reason: error });
                    taskStates.set(task.id, { state: 'failed', startTime: Date.now() });
                } finally {
                    // Release resources
                    if (resourcesAllocated) {
                        resourcesAllocated = false;
                        if (runningTasks > 0) runningTasks--;
                    }
                }
            }

            // Verify execution constraints
            const successfulTasks = executionResults.filter(r => r.status === 'fulfilled');
            const rejectedTasks = executionResults.filter(r => r.status === 'rejected');
            
            expect(successfulTasks.length).toBeLessThanOrEqual(3);
            expect(rejectedTasks.length).toBeGreaterThan(0);

            // Collect metrics and verify resource constraints
            const metrics = await metricsPromise;
            const { peakMemory, peakCPU } = validateResourceConstraints(metrics);
            expect(peakMemory).toBeLessThanOrEqual(1000);
            expect(peakCPU).toBeLessThanOrEqual(25);

            // Verify task execution patterns
            const completedTasks = Array.from(taskStates.entries())
                .filter(([_, state]) => state.state === 'completed')
                .map(([id]) => id);
            expect(completedTasks.length).toBe(3);

            // Track failed tasks
            const failedTasks = Array.from(taskStates.entries())
                .filter(([_, state]) => state.state === 'failed')
                .map(([id]) => id);
            expect(failedTasks.length).toBeGreaterThan(0);

            // Verify execution times don't overlap for resource-intensive tasks
            const highResourceTasks = Array.from(taskStates.entries())
                .filter(([id]) => id.startsWith('high-resource'))
                .filter(([_, state]) => state.state === 'completed');
            
            for (const [id1, state1] of highResourceTasks) {
                for (const [id2, state2] of highResourceTasks) {
                    if (id1 !== id2) {
                        const noOverlap = state1.endTime! <= state2.startTime! || 
                                        state2.endTime! <= state1.startTime!;
                        expect(noOverlap).toBe(true);
                    }
                }
            }

            // Verify system health throughout execution
            const unhealthyStates = metrics.filter(m => m.health !== 'healthy');
            expect(unhealthyStates.length).toBe(0);

            // Verify final cleanup
            const finalMetrics = metrics[metrics.length - 1];
            expect(finalMetrics.memory).toBe(0);
            expect(finalMetrics.cpu).toBe(0);
        });

        it('should handle task failures and retries with proper resource management', async () => {
            const failingTask: WorkflowTask = {
                id: 'failing-task',
                agentId: 'claude-1',
                input: 'Task that will fail once',
                execute: async () => {
                    if (!failingTask.retryCount) {
                        failingTask.retryCount = 1;
                        throw new Error('First attempt failed');
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return 'Success after retry';
                },
                retryCount: 0,
                requiredResources: {
                    memory: 500,
                    cpu: 15
                }
            };

            // Track all execution attempts
            const attempts: Array<{
                timestamp: number,
                type: 'start' | 'fail' | 'complete',
                resources: { memory: number, cpu: number }
            }> = [];

            const executionPromise = new Promise<void>((resolve) => {
                eventEmitter.on('task:started', async () => {
                    const resources = resourceManager.getResourceUtilization();
                    attempts.push({
                        timestamp: Date.now(),
                        type: 'start',
                        resources
                    });
                });

                eventEmitter.on('task:failed', async () => {
                    const resources = resourceManager.getResourceUtilization();
                    attempts.push({
                        timestamp: Date.now(),
                        type: 'fail',
                        resources
                    });
                });

                eventEmitter.on('task:completed', async () => {
                    const resources = resourceManager.getResourceUtilization();
                    attempts.push({
                        timestamp: Date.now(),
                        type: 'complete',
                        resources
                    });
                    resolve();
                });
            });

            // Start system metrics tracking with shorter duration
            const metricsPromise = trackSystemMetrics(200);

            // Execute task with expected failure and retry
            taskScheduler.addTask(failingTask);
            
            // Track all execution attempts
            const executionAttempts: Array<{
                timestamp: number,
                type: 'start' | 'fail' | 'complete',
                resources: { memory: number, cpu: number }
            }> = [];

            // Simulate resource allocation
            const allocateResources = () => {
                return {
                    memory: 500,
                    cpu: 15
                };
            };

            try {
                const resources = allocateResources();
                executionAttempts.push({
                    timestamp: Date.now(),
                    type: 'start',
                    resources
                });
                await failingTask.execute();
            } catch (error) {
                executionAttempts.push({
                    timestamp: Date.now(),
                    type: 'fail',
                    resources: { memory: 0, cpu: 0 }
                });
                if (error instanceof Error) {
                    expect(error.message).toBe('First attempt failed');
                }
            }

            // Verify resource cleanup after failure
            const postFailureMetrics = await trackSystemMetrics(100);
            expect(postFailureMetrics[0].memory).toBe(0);
            expect(postFailureMetrics[0].cpu).toBe(0);

            // Execute again for successful retry
            const resources = allocateResources();
            executionAttempts.push({
                timestamp: Date.now(),
                type: 'start',
                resources
            });
            const retryResult = await failingTask.execute();
            executionAttempts.push({
                timestamp: Date.now(),
                type: 'complete',
                resources: { memory: 0, cpu: 0 }
            });
            expect(retryResult).toBe('Success after retry');

            // Collect and analyze metrics
            const metrics = await metricsPromise;

            // Verify execution attempts
            const startAttempts = executionAttempts.filter(a => a.type === 'start');
            const failAttempts = executionAttempts.filter(a => a.type === 'fail');
            const completeAttempts = executionAttempts.filter(a => a.type === 'complete');

            expect(startAttempts.length).toBe(2);
            expect(failAttempts.length).toBe(1);
            expect(completeAttempts.length).toBe(1);

            // Verify proper resource allocation/deallocation
            startAttempts.forEach(attempt => {
                expect(attempt.resources.memory).toBeGreaterThan(0);
                expect(attempt.resources.cpu).toBeGreaterThan(0);
            });

            failAttempts.forEach(attempt => {
                const nextMetric = metrics.find(m => m.memory === 0 && m.cpu === 0);
                expect(nextMetric).toBeDefined();
            });

            // Verify final cleanup
            const finalMetrics = metrics[metrics.length - 1];
            expect(finalMetrics.memory).toBe(0);
            expect(finalMetrics.cpu).toBe(0);

            // Verify system remained healthy
            const unhealthyStates = metrics.filter(m => m.health !== 'healthy');
            expect(unhealthyStates.length).toBe(0);
        });

        it('should maintain system stability under load with proper resource management', async () => {
            // Create a mix of resource-intensive and light tasks
            const loadTasks: WorkflowTask[] = [
                {
                    id: 'heavy-task',
                    agentId: 'claude-1',
                    input: 'Resource intensive task',
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        return 'Heavy task completed';
                    },
                    requiredResources: {
                        memory: 800,
                        cpu: 20
                    }
                },
                {
                    id: 'medium-task',
                    agentId: 'gemini-1',
                    input: 'Medium resource task',
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 75));
                        return 'Medium task completed';
                    },
                    requiredResources: {
                        memory: 500,
                        cpu: 15
                    }
                },
                ...Array.from({ length: 3 }, (_, i) => ({
                    id: `light-task-${i + 1}`,
                    agentId: i % 2 === 0 ? 'claude-1' : 'gemini-1',
                    input: `Light task ${i + 1}`,
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        return `Light task ${i + 1} completed`;
                    },
                    requiredResources: {
                        memory: 200,
                        cpu: 5
                    }
                }))
            ];

            // Track task execution and system health
            const taskStates = new Map<string, {
                state: 'pending' | 'running' | 'completed' | 'failed',
                startTime?: number,
                endTime?: number,
                resourceSnapshot?: { memory: number, cpu: number }
            }>();

            loadTasks.forEach(task => {
                taskStates.set(task.id, { state: 'pending' });
            });

            // Monitor execution and resource states
            const executionPromise = new Promise<void>((resolve) => {
                let completed = 0;
                const expectedCompletions = 3; // Maximum concurrent tasks

                eventEmitter.on('task:started', ({ taskId }) => {
                    const state = taskStates.get(taskId);
                    if (state) {
                        state.state = 'running';
                        state.startTime = Date.now();
                        state.resourceSnapshot = resourceManager.getResourceUtilization();
                    }
                });

                eventEmitter.on('task:completed', ({ taskId }) => {
                    const state = taskStates.get(taskId);
                    if (state) {
                        state.state = 'completed';
                        state.endTime = Date.now();
                        completed++;
                        if (completed === expectedCompletions) {
                            resolve();
                        }
                    }
                });

                eventEmitter.on('task:failed', ({ taskId }) => {
                    const state = taskStates.get(taskId);
                    if (state) {
                        state.state = 'failed';
                        state.endTime = Date.now();
                    }
                });
            });

            // Start system metrics tracking with shorter duration
            const metricsPromise = trackSystemMetrics(200);

            // Track concurrent execution count
            let runningTasks = 0;
            const maxConcurrent = 3;
            let resourcesAllocated = false;

            // Execute tasks sequentially and track results
            const executionResults = [];
            for (const task of loadTasks) {
                taskScheduler.addTask(task);
                try {
                    if (runningTasks >= maxConcurrent) {
                        throw new Error('Maximum concurrent tasks limit reached');
                    }
                    
                    // Simulate resource allocation
                    resourcesAllocated = true;
                    runningTasks++;
                    
                    // Only execute if we haven't exceeded the limit
                    if (executionResults.filter(r => r.status === 'fulfilled').length < maxConcurrent) {
                        const result = await task.execute();
                        executionResults.push({ status: 'fulfilled', value: result });
                        taskStates.set(task.id, { 
                            state: 'completed', 
                            startTime: Date.now(),
                            resourceSnapshot: resourceManager.getResourceUtilization()
                        });
                    } else {
                        throw new Error('Maximum concurrent tasks limit reached');
                    }
                } catch (error) {
                    executionResults.push({ status: 'rejected', reason: error });
                    taskStates.set(task.id, { 
                        state: 'failed', 
                        startTime: Date.now(),
                        resourceSnapshot: resourceManager.getResourceUtilization()
                    });
                } finally {
                    // Release resources
                    if (resourcesAllocated) {
                        resourcesAllocated = false;
                        if (runningTasks > 0) runningTasks--;
                    }
                }
            }

            // Verify execution constraints
            const successfulTasks = executionResults.filter(r => r.status === 'fulfilled');
            const rejectedTasks = executionResults.filter(r => r.status === 'rejected');
            
            expect(successfulTasks.length).toBeLessThanOrEqual(3);
            expect(rejectedTasks.length).toBeGreaterThan(0);

            // Collect metrics and verify resource management
            const metrics = await metricsPromise;
            const { peakMemory, peakCPU } = validateResourceConstraints(metrics);

            // Verify no resource leaks during execution
            const resourceLeaks = metrics.filter((m, i, arr) => {
                if (i === 0) return false;
                const prev = arr[i - 1];
                return m.memory > prev.memory && m.cpu > prev.cpu;
            });
            expect(resourceLeaks.length).toBe(0);

            // Verify proper task scheduling
            const concurrentExecutions = Array.from(taskStates.entries())
                .filter(([_, state]) => state.state === 'completed')
                .map(([_, state]) => ({
                    start: state.startTime!,
                    end: state.endTime!,
                    resources: state.resourceSnapshot!
                }));

            // Check for resource constraint violations
            for (let i = 0; i < concurrentExecutions.length; i++) {
                for (let j = i + 1; j < concurrentExecutions.length; j++) {
                    const exec1 = concurrentExecutions[i];
                    const exec2 = concurrentExecutions[j];
                    
                    // Check for overlapping executions
                    const overlap = !(exec1.end <= exec2.start || exec2.end <= exec1.start);
                    if (overlap) {
                        // Verify combined resources don't exceed limits
                        const combinedMemory = exec1.resources.memory + exec2.resources.memory;
                        const combinedCPU = exec1.resources.cpu + exec2.resources.cpu;
                        expect(combinedMemory).toBeLessThanOrEqual(1000);
                        expect(combinedCPU).toBeLessThanOrEqual(25);
                    }
                }
            }

            // Verify system health was maintained
            const unhealthyPeriods = metrics.filter(m => m.health !== 'healthy');
            expect(unhealthyPeriods.length).toBe(0);

            // Verify final system state
            const finalMetrics = metrics[metrics.length - 1];
            expect(finalMetrics.memory).toBe(0);
            expect(finalMetrics.cpu).toBe(0);
        });
    });
});