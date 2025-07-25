import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowEngine } from '../services/workflowEngine';
import { EnhancedOrchestrator } from '../services/enhancedOrchestrator';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { ResourceAwareTaskRouter } from '../services/resourceAwareTaskRouter';
import { ResourceLimits } from '../services/resourceManager';
import {
    WorkflowDefinition,
    WorkflowStatus,
    WorkflowPriority,
    WorkflowStep
} from '../types/workflow';

describe('WorkflowEngine Integration Tests', () => {
    let workflowEngine: WorkflowEngine;
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

    const createMockStep = (id: string, dependencies: string[] = []): WorkflowStep => ({
        id,
        name: `Step ${id}`,
        execute: async (variables: Record<string, any>) => {
            return { result: `Executed step ${id}` };
        },
        dependencies,
        resourceRequirements: {
            cpu: 10,
            memory: 100 * 1024 * 1024, // 100MB
            priority: WorkflowPriority.NORMAL
        }
    });

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(mockLimits);
        taskRouter = new ResourceAwareTaskRouter();
        orchestrator = new EnhancedOrchestrator(resourceManager, taskRouter);
        workflowEngine = new WorkflowEngine(resourceManager);

        // Mock resource manager methods
        vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
            memory: {
                total: mockLimits.memory.max,
                used: 512 * 1024 * 1024,
                free: mockLimits.memory.max - 512 * 1024 * 1024,
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
                memory: mockLimits.memory.max - 512 * 1024 * 1024,
                cpu: 30
            },
            utilizationPercentages: {
                memory: 50,
                cpu: 50
            }
        });

        vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
            memory: 50,
            cpu: 50
        });
    });

    describe('Workflow Creation and Execution', () => {
        it('should create and execute a simple workflow', async () => {
            const definition: WorkflowDefinition = {
                name: 'Simple Workflow',
                version: '1.0.0',
                steps: [
                    createMockStep('step1'),
                    createMockStep('step2', ['step1'])
                ]
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            const statusSpy = vi.fn();
            workflowEngine.on('workflow:completed', statusSpy);

            await workflowEngine.startWorkflow(workflowId);

            expect(statusSpy).toHaveBeenCalled();
            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });

        it('should handle parallel steps execution', async () => {
            const definition: WorkflowDefinition = {
                name: 'Parallel Workflow',
                version: '1.0.0',
                steps: [
                    createMockStep('step1'),
                    {
                        ...createMockStep('step2'),
                        parallel: true
                    },
                    {
                        ...createMockStep('step3'),
                        parallel: true
                    }
                ],
                maxConcurrentSteps: 2
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);

            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });

        it('should respect resource limits', async () => {
            // Override resource utilization for this test
            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 85,
                cpu: 85
            });

            const definition: WorkflowDefinition = {
                name: 'Resource Limited Workflow',
                version: '1.0.0',
                steps: [
                    {
                        ...createMockStep('step1'),
                        resourceRequirements: {
                            cpu: 90, // Exceeds CPU limit
                            memory: 100 * 1024 * 1024,
                            priority: WorkflowPriority.HIGH
                        }
                    }
                ],
                resourceLimits: {
                    cpu: 80,
                    memory: 1024 * 1024 * 1024
                }
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            const errorSpy = vi.fn();
            workflowEngine.on('workflow:failed', errorSpy);

            await workflowEngine.startWorkflow(workflowId);

            expect(errorSpy).toHaveBeenCalled();
            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.FAILED);
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should handle step failures and rollback', async () => {
            const rollbackSpy = vi.fn();
            const definition: WorkflowDefinition = {
                name: 'Rollback Workflow',
                version: '1.0.0',
                steps: [
                    {
                        ...createMockStep('step1'),
                        rollback: async () => {
                            rollbackSpy();
                        }
                    },
                    {
                        ...createMockStep('step2'),
                        execute: async () => {
                            throw new Error('Step 2 failed');
                        }
                    }
                ],
                rollbackOnError: true
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);

            expect(rollbackSpy).toHaveBeenCalled();
            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.ROLLED_BACK);
        });

        it('should retry failed steps according to policy', async () => {
            const executeSpy = vi.fn()
                .mockRejectedValueOnce(new Error('First attempt failed'))
                .mockResolvedValueOnce({ result: 'Success' });

            const definition: WorkflowDefinition = {
                name: 'Retry Workflow',
                version: '1.0.0',
                steps: [
                    {
                        ...createMockStep('step1'),
                        execute: executeSpy,
                        retryPolicy: {
                            maxAttempts: 2,
                            backoffMultiplier: 1,
                            maxDelay: 100
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);

            expect(executeSpy).toHaveBeenCalledTimes(2);
            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });
    });

    describe('Resource Management', () => {
        it('should track resource usage', async () => {
            const definition: WorkflowDefinition = {
                name: 'Resource Tracking Workflow',
                version: '1.0.0',
                steps: [
                    createMockStep('step1'),
                    createMockStep('step2')
                ]
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);

            const metrics = workflowEngine.getWorkflowMetrics(workflowId);
            expect(metrics).toBeDefined();
            expect(metrics?.resourceUtilization.cpu).toBeDefined();
            expect(metrics?.resourceUtilization.memory).toBeDefined();
        });

        it('should emit resource warnings', async () => {
            // Override resource utilization for this test
            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 75,
                cpu: 75
            });

            const warningSpy = vi.fn();
            workflowEngine.on('workflow:resource:warning', warningSpy);

            const definition: WorkflowDefinition = {
                name: 'Resource Warning Workflow',
                version: '1.0.0',
                steps: [
                    {
                        ...createMockStep('step1'),
                        resourceRequirements: {
                            cpu: mockLimits.cpu.warning + 1,
                            memory: 100 * 1024 * 1024,
                            priority: WorkflowPriority.HIGH
                        }
                    }
                ]
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);

            expect(warningSpy).toHaveBeenCalled();
        });
    });

    describe('Workflow Control', () => {
        it('should pause and resume workflow execution', async () => {
            const definition: WorkflowDefinition = {
                name: 'Control Workflow',
                version: '1.0.0',
                steps: [
                    createMockStep('step1'),
                    createMockStep('step2')
                ]
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);
            await workflowEngine.pauseWorkflow(workflowId);

            let status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.PAUSED);

            await workflowEngine.resumeWorkflow(workflowId);
            status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });

        it('should cancel workflow and rollback if configured', async () => {
            const rollbackSpy = vi.fn();
            const definition: WorkflowDefinition = {
                name: 'Cancel Workflow',
                version: '1.0.0',
                steps: [
                    {
                        ...createMockStep('step1'),
                        rollback: async () => {
                            rollbackSpy();
                        }
                    },
                    createMockStep('step2')
                ],
                rollbackOnCancel: true
            };

            const workflowId = workflowEngine.createWorkflow(definition);
            await workflowEngine.startWorkflow(workflowId);
            await workflowEngine.cancelWorkflow(workflowId);

            expect(rollbackSpy).toHaveBeenCalled();
            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.CANCELLED);
        });
    });
});