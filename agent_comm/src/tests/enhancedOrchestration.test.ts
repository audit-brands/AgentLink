import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnhancedWorkflowEngine } from '../services/enhancedWorkflowEngine';
import { EnhancedTaskRouter } from '../services/enhancedTaskRouter';
import { ResourceManager } from '../services/resourceManager';
import { InMemoryAgentRegistry } from '../services/agentRegistry';
import { 
    WorkflowDefinition,
    WorkflowStatus,
    WorkflowPriority,
    WorkflowStep
} from '../types/workflow';
import { AgentStatus } from '../types/orchestration';

describe('Enhanced Orchestration System', () => {
    let workflowEngine: EnhancedWorkflowEngine;
    let taskRouter: EnhancedTaskRouter;
    let resourceManager: ResourceManager;
    let agentRegistry: InMemoryAgentRegistry;

    beforeEach(() => {
        // Setup resource manager with mock metrics
        resourceManager = new ResourceManager({
            memory: { max: 8 * 1024 * 1024 * 1024, warning: 6 * 1024 * 1024 * 1024 },
            cpu: { maxUsage: 80, warning: 60 }
        });

        // Mock resource metrics
        vi.spyOn(resourceManager, 'getMetrics').mockImplementation(() => ({
            memory: {
                max: 8 * 1024 * 1024 * 1024,
                current: 4 * 1024 * 1024 * 1024,
                warning: 6 * 1024 * 1024 * 1024
            },
            cpu: {
                current: 40,
                warning: 60,
                maxUsage: 80
            }
        }));

        // Setup agent registry with mock agents
        agentRegistry = new InMemoryAgentRegistry();

        // Register test agents
        const testAgents = [
            {
                id: 'agent1',
                name: 'Agent 1',
                status: AgentStatus.ONLINE,
                endpoint: 'http://localhost:8081',
                capabilities: [
                    { name: 'compute', methods: ['process', 'analyze'] },
                    { name: 'storage', methods: ['store', 'retrieve'] }
                ],
                lastSeen: new Date()
            },
            {
                id: 'agent2',
                name: 'Agent 2',
                status: AgentStatus.ONLINE,
                endpoint: 'http://localhost:8082',
                capabilities: [
                    { name: 'compute', methods: ['process'] },
                    { name: 'network', methods: ['send', 'receive'] }
                ],
                lastSeen: new Date()
            }
        ];

        testAgents.forEach(agent => {
            agentRegistry.register(agent).catch(console.error);
        });

        // Setup task router
        taskRouter = new EnhancedTaskRouter(agentRegistry, resourceManager, {
            healthCheckInterval: 1000,
            loadBalancingWindow: 5000,
            maxRetries: 3
        });

        // Setup workflow engine
        workflowEngine = new EnhancedWorkflowEngine(
            taskRouter,
            resourceManager,
            {
                maxConcurrentWorkflows: 5,
                maxRetryAttempts: 3,
                resourceThreshold: 0.8,
                planningInterval: 1000
            }
        );
    });

    afterEach(async () => {
        vi.clearAllMocks();
        if (workflowEngine) {
            await workflowEngine.cleanup();
        }
        if (taskRouter) {
            await taskRouter.cleanup();
        }
    });

    describe('Task Routing', () => {
        it('should route tasks based on agent capabilities', async () => {
            const routeHandler = vi.fn();
            const task = {
                id: 'task1',
                method: 'process',
                params: { data: 'test' }
            };

            // Monitor routing decisions
            taskRouter.on('route', routeHandler);

            const agentId = await taskRouter.route(task);
            expect(agentId).toBeDefined();
            expect(['agent1', 'agent2']).toContain(agentId);
        });

        it('should consider resource usage in routing decisions', async () => {
            // Simulate high resource usage for agent1
            vi.spyOn(taskRouter, 'getAgentMetrics').mockImplementation((agentId) => {
                if (agentId === 'agent1') {
                    return {
                        taskCount: 10,
                        successRate: 0.9,
                        averageLatency: 100,
                        lastUsed: Date.now(),
                        resourceUsage: { cpu: 0.9, memory: 0.8 },
                        capabilities: new Set(['process', 'analyze'])
                    };
                }
                return {
                    taskCount: 5,
                    successRate: 0.95,
                    averageLatency: 80,
                    lastUsed: Date.now(),
                    resourceUsage: { cpu: 0.4, memory: 0.3 },
                    capabilities: new Set(['process'])
                };
            });

            const task = {
                id: 'task2',
                method: 'process',
                params: { data: 'test' }
            };

            const agentId = await taskRouter.route(task);
            expect(agentId).toBe('agent2'); // Should choose agent2 due to lower resource usage
        });

        it('should handle agent failures gracefully', async () => {
            // Simulate agent1 failure
            vi.spyOn(global, 'fetch').mockImplementationOnce(() => 
                Promise.reject(new Error('Connection failed'))
            );

            const errorHandler = vi.fn();
            taskRouter.on('error', errorHandler);

            const task = {
                id: 'task3',
                method: 'process',
                params: { data: 'test' }
            };

            const agentId = await taskRouter.route(task);
            expect(agentId).toBe('agent2'); // Should failover to agent2
            expect(errorHandler).toHaveBeenCalled();
        });
    });

    describe('Workflow Execution', () => {
        it('should execute workflow steps in parallel when possible', async () => {
            const stepExecutions: string[] = [];
            const workflow: WorkflowDefinition = {
                name: 'Parallel Test',
                version: '1.0',
                steps: [
                    {
                        id: 'step1',
                        name: 'Step 1',
                        parallel: true,
                        execute: async () => {
                            stepExecutions.push('step1');
                            return 'result1';
                        }
                    },
                    {
                        id: 'step2',
                        name: 'Step 2',
                        parallel: true,
                        execute: async () => {
                            stepExecutions.push('step2');
                            return 'result2';
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            const state = workflowEngine.getWorkflowStatus(workflowId);
            expect(state?.status).toBe(WorkflowStatus.COMPLETED);
            expect(stepExecutions).toHaveLength(2);
        });

        it('should handle workflow priorities correctly', async () => {
            const executions: string[] = [];
            
            // Create multiple workflows with different priorities
            const createWorkflow = (id: string, priority: WorkflowPriority): WorkflowDefinition => ({
                name: `Workflow ${id}`,
                version: '1.0',
                steps: [
                    {
                        id: `step_${id}`,
                        name: `Step ${id}`,
                        execute: async () => {
                            executions.push(id);
                            return `result_${id}`;
                        }
                    }
                ]
            });

            const lowPriorityId = workflowEngine.createWorkflow(
                createWorkflow('low', WorkflowPriority.LOW),
                { priority: WorkflowPriority.LOW }
            );

            const highPriorityId = workflowEngine.createWorkflow(
                createWorkflow('high', WorkflowPriority.HIGH),
                { priority: WorkflowPriority.HIGH }
            );

            const normalPriorityId = workflowEngine.createWorkflow(
                createWorkflow('normal', WorkflowPriority.NORMAL),
                { priority: WorkflowPriority.NORMAL }
            );

            // Start all workflows
            await Promise.all([
                workflowEngine.startWorkflow(lowPriorityId),
                workflowEngine.startWorkflow(highPriorityId),
                workflowEngine.startWorkflow(normalPriorityId)
            ]);

            // High priority should be executed first
            expect(executions[0]).toBe('high');
        });

        it('should handle resource constraints', async () => {
            // Simulate resource pressure
            vi.spyOn(resourceManager, 'getAvailableResources').mockImplementation(() => ({
                cpu: 0.2, // Only 20% CPU available
                memory: 0.3 // Only 30% memory available
            }));

            const workflow: WorkflowDefinition = {
                name: 'Resource Test',
                version: '1.0',
                steps: [
                    {
                        id: 'heavy_step',
                        name: 'Heavy Step',
                        resourceRequirements: {
                            cpu: 0.5, // Requires 50% CPU
                            memory: 0.5 // Requires 50% memory
                        },
                        execute: async () => 'result'
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            const resourceWarning = vi.fn();
            workflowEngine.on('workflow:resource:warning', resourceWarning);

            await workflowEngine.startWorkflow(workflowId);
            expect(resourceWarning).toHaveBeenCalled();
        });

        it('should handle step dependencies correctly', async () => {
            const executions: string[] = [];
            const workflow: WorkflowDefinition = {
                name: 'Dependency Test',
                version: '1.0',
                steps: [
                    {
                        id: 'step1',
                        name: 'Step 1',
                        execute: async () => {
                            executions.push('step1');
                            return 'result1';
                        }
                    },
                    {
                        id: 'step2',
                        name: 'Step 2',
                        dependencies: ['step1'],
                        execute: async () => {
                            executions.push('step2');
                            return 'result2';
                        }
                    },
                    {
                        id: 'step3',
                        name: 'Step 3',
                        dependencies: ['step2'],
                        execute: async () => {
                            executions.push('step3');
                            return 'result3';
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            expect(executions).toEqual(['step1', 'step2', 'step3']);
        });

        it('should handle workflow rollback on failure', async () => {
            const rollbackSteps: string[] = [];
            const workflow: WorkflowDefinition = {
                name: 'Rollback Test',
                version: '1.0',
                rollbackOnError: true,
                steps: [
                    {
                        id: 'step1',
                        name: 'Step 1',
                        execute: async () => 'result1',
                        rollback: async () => {
                            rollbackSteps.push('step1');
                        }
                    },
                    {
                        id: 'step2',
                        name: 'Step 2',
                        execute: async () => {
                            throw new Error('Step 2 failed');
                        },
                        rollback: async () => {
                            rollbackSteps.push('step2');
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            const state = workflowEngine.getWorkflowStatus(workflowId);
            expect(state?.status).toBe(WorkflowStatus.ROLLED_BACK);
            expect(rollbackSteps).toEqual(['step2', 'step1']);
        });
    });

    describe('Metrics and Monitoring', () => {
        it('should track workflow metrics', async () => {
            const workflow: WorkflowDefinition = {
                name: 'Metrics Test',
                version: '1.0',
                steps: [
                    {
                        id: 'step1',
                        name: 'Step 1',
                        execute: async () => {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            return 'result1';
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            const metrics = workflowEngine.getWorkflowMetrics(workflowId);
            expect(metrics).toBeDefined();
            expect(metrics?.totalDuration).toBeGreaterThan(0);
            expect(metrics?.resourceUtilization).toBeDefined();
        });

        it('should emit resource warning events', async () => {
            // Simulate increasing resource usage
            let cpuUsage = 40;
            vi.spyOn(resourceManager, 'getMetrics').mockImplementation(() => ({
                memory: {
                    max: 8 * 1024 * 1024 * 1024,
                    current: 4 * 1024 * 1024 * 1024,
                    warning: 6 * 1024 * 1024 * 1024
                },
                cpu: {
                    current: cpuUsage += 10, // Incrementing CPU usage
                    warning: 60,
                    maxUsage: 80
                }
            }));

            const warningHandler = vi.fn();
            workflowEngine.on('workflow:resource:warning', warningHandler);

            const workflow: WorkflowDefinition = {
                name: 'Resource Warning Test',
                version: '1.0',
                steps: [
                    {
                        id: 'step1',
                        name: 'Step 1',
                        execute: async () => {
                            await new Promise(resolve => setTimeout(resolve, 500));
                            return 'result1';
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            expect(warningHandler).toHaveBeenCalled();
        });
    });
});