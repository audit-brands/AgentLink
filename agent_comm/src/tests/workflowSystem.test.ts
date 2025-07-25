import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { WorkflowMetricsService } from '../services/workflowMetrics';
import { WorkflowEngine } from '../services/workflowEngine';
import { WorkflowDefinition, WorkflowStatus, WorkflowPriority } from '../types/workflow';

describe('Workflow System Integration', () => {
    let resourceManager: EnhancedResourceManager;
    let metricsService: WorkflowMetricsService;
    let workflowEngine: WorkflowEngine;

    const mockLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024 // 768MB
        },
        cpu: {
            maxUsage: 90,
            warning: 70
        }
    };

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(mockLimits);
        metricsService = new WorkflowMetricsService(resourceManager);
        workflowEngine = new WorkflowEngine(resourceManager);
    });

    describe('Resource Management', () => {
        it('should track resource utilization', async () => {
            const metrics = await resourceManager.getEnhancedMetrics();
            
            expect(metrics.availableResources).toBeDefined();
            expect(metrics.availableResources.memory).toBeGreaterThan(0);
            expect(metrics.availableResources.cpu).toBeGreaterThan(0);
            expect(metrics.utilizationPercentages.memory).toBeDefined();
            expect(metrics.utilizationPercentages.cpu).toBeDefined();
        });

        it('should correctly determine task capacity', async () => {
            const canHandle = await resourceManager.canHandleTask({
                memory: 512 * 1024 * 1024, // 512MB
                cpu: 50 // 50%
            });

            expect(canHandle).toBe(true);
        });

        it('should reject tasks exceeding resource limits', async () => {
            const canHandle = await resourceManager.canHandleTask({
                memory: 2 * 1024 * 1024 * 1024, // 2GB
                cpu: 95 // 95%
            });

            expect(canHandle).toBe(false);
        });
    });

    describe('Workflow Metrics', () => {
        it('should initialize workflow metrics correctly', () => {
            const workflow: WorkflowDefinition = {
                name: 'Test Workflow',
                version: '1.0',
                steps: []
            };
            const workflowId = workflowEngine.createWorkflow(workflow);
            metricsService.initializeWorkflow(workflowId);
            const metrics = metricsService.getMetrics(workflowId);

            expect(metrics).toBeDefined();
            expect(metrics?.activeWorkflows).toBe(1);
            expect(metrics?.completedWorkflows).toBe(0);
            expect(metrics?.failedWorkflows).toBe(0);
        });

        it('should track resource utilization over time', async () => {
            const workflow: WorkflowDefinition = {
                name: 'Test Workflow',
                version: '1.0',
                steps: []
            };
            const workflowId = workflowEngine.createWorkflow(workflow);
            metricsService.initializeWorkflow(workflowId);

            await metricsService.updateMetrics(workflowId, {
                id: workflowId,
                status: WorkflowStatus.RUNNING,
                currentStep: 0,
                steps: [],
                variables: {},
                definition: workflow,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            const metrics = metricsService.getMetrics(workflowId);
            expect(metrics?.resourceUtilization.cpu).toBeDefined();
            expect(metrics?.resourceUtilization.memory).toBeDefined();
        });

        it('should detect resource warnings', () => {
            const workflow: WorkflowDefinition = {
                name: 'Test Workflow',
                version: '1.0',
                steps: []
            };
            const workflowId = workflowEngine.createWorkflow(workflow);
            metricsService.initializeWorkflow(workflowId);
            const { warnings, critical } = metricsService.checkResourceWarnings(workflowId);

            expect(Array.isArray(warnings)).toBe(true);
            expect(Array.isArray(critical)).toBe(true);
        });
    });

    describe('Workflow Execution', () => {
        it('should execute workflow steps with resource checks', async () => {
            const stepExecuted = vi.fn();
            const workflow: WorkflowDefinition = {
                name: 'Test Workflow',
                version: '1.0',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: async () => {
                        stepExecuted();
                        return true;
                    },
                    resourceRequirements: {
                        cpu: 10,
                        memory: 100 * 1024 * 1024,
                        priority: WorkflowPriority.NORMAL
                    }
                }]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(stepExecuted).toHaveBeenCalled();
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });

        it('should handle workflow failures and rollback', async () => {
            const rollbackExecuted = vi.fn();
            const workflow: WorkflowDefinition = {
                name: 'Test Workflow',
                version: '1.0',
                steps: [{
                    id: 'step1',
                    name: 'Failing Step',
                    execute: async () => {
                        throw new Error('Step failed');
                    },
                    rollback: async () => {
                        rollbackExecuted();
                    },
                    resourceRequirements: {
                        cpu: 10,
                        memory: 100 * 1024 * 1024,
                        priority: WorkflowPriority.NORMAL
                    }
                }],
                rollbackOnError: true
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(rollbackExecuted).toHaveBeenCalled();
            expect(status?.status).toBe(WorkflowStatus.FAILED);
        });

        it('should respect resource priorities', async () => {
            const criticalStepExecuted = vi.fn();
            const workflow: WorkflowDefinition = {
                name: 'Test Workflow',
                version: '1.0',
                steps: [{
                    id: 'step1',
                    name: 'Critical Step',
                    execute: async () => {
                        criticalStepExecuted();
                        return true;
                    },
                    resourceRequirements: {
                        cpu: 85,
                        memory: 900 * 1024 * 1024,
                        priority: WorkflowPriority.CRITICAL
                    }
                }]
            };

            const workflowId = workflowEngine.createWorkflow(workflow);
            await workflowEngine.startWorkflow(workflowId);

            expect(criticalStepExecuted).toHaveBeenCalled();
        });
    });
});