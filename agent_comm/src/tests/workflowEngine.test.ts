import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkflowEngine } from '../services/workflowEngine';
import { WorkflowStatus, WorkflowDefinition } from '../types/workflow';

describe('WorkflowEngine Phase 2', () => {
    let workflowEngine: WorkflowEngine;
    let mockWorkflow: WorkflowDefinition;

    beforeEach(() => {
        const mockResourceManager = {
            getEnhancedMetrics: vi.fn().mockResolvedValue({
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
                }
            }),
            getResourceUtilization: vi.fn().mockReturnValue({
                memory: 50,
                cpu: 50
            })
        };
        workflowEngine = new WorkflowEngine(mockResourceManager);
        
        // Create a mock workflow
        mockWorkflow = {
            name: 'Test Workflow',
            description: 'Test workflow for unit tests',
            steps: [
                {
                    id: 'step1',
                    name: 'Step 1',
                    execute: vi.fn().mockResolvedValue('step1 result'),
                    outputVariable: 'step1Output'
                },
                {
                    id: 'step2',
                    name: 'Step 2',
                    condition: async (vars) => vars.step1Output === 'step1 result',
                    execute: vi.fn().mockResolvedValue('step2 result'),
                    rollback: vi.fn().mockResolvedValue(undefined)
                },
                {
                    id: 'step3',
                    name: 'Step 3',
                    execute: vi.fn().mockResolvedValue('step3 result'),
                    errorHandler: vi.fn().mockResolvedValue(undefined),
                    continueOnError: true
                }
            ],
            rollbackOnError: true
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Workflow Creation and Execution', () => {
        it('should create and execute workflow successfully', async () => {
            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            expect(workflowId).toBeDefined();

            const eventHandler = vi.fn();
            workflowEngine.on('workflow:completed', eventHandler);

            await workflowEngine.startWorkflow(workflowId);
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
            expect(eventHandler).toHaveBeenCalled();
            expect(mockWorkflow.steps[0].execute).toHaveBeenCalled();
            expect(mockWorkflow.steps[1].execute).toHaveBeenCalled();
            expect(mockWorkflow.steps[2].execute).toHaveBeenCalled();
        });

        it('should handle conditional steps correctly', async () => {
            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            
            // Make condition return false
            mockWorkflow.steps[1].condition = async () => false;
            
            await workflowEngine.startWorkflow(workflowId);
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
            expect(mockWorkflow.steps[0].execute).toHaveBeenCalled();
            expect(mockWorkflow.steps[1].execute).not.toHaveBeenCalled();
            expect(mockWorkflow.steps[2].execute).toHaveBeenCalled();
        });
    });

    describe('Error Handling and Rollback', () => {
        it('should handle step failures and trigger rollback', async () => {
            const error = new Error('Step 2 failed');
            mockWorkflow.steps[1].execute = vi.fn().mockRejectedValue(error);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            const rollbackHandler = vi.fn();
            workflowEngine.on('workflow:rollback:completed', rollbackHandler);

            await workflowEngine.startWorkflow(workflowId);
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.ROLLED_BACK);
            expect(status?.error).toBe(error.message);
            expect(mockWorkflow.steps[1].rollback).toHaveBeenCalled();
            expect(rollbackHandler).toHaveBeenCalled();
        });

        it('should continue on error when specified', async () => {
            const error = new Error('Step 3 failed');
            mockWorkflow.steps[2].execute = vi.fn().mockRejectedValue(error);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);
            const status = workflowEngine.getWorkflowStatus(workflowId);

            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
            expect(mockWorkflow.steps[2].errorHandler).toHaveBeenCalled();
        });
    });

    describe('Workflow Control', () => {
        it('should pause and resume workflow', async () => {
            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);
            await workflowEngine.pauseWorkflow(workflowId);

            let status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.PAUSED);

            await workflowEngine.resumeWorkflow(workflowId);
            status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.COMPLETED);
        });

        it('should cancel workflow and trigger rollback', async () => {
            const workflowId = workflowEngine.createWorkflow({
                ...mockWorkflow,
                rollbackOnCancel: true
            });

            await workflowEngine.startWorkflow(workflowId);
            await workflowEngine.cancelWorkflow(workflowId);

            const status = workflowEngine.getWorkflowStatus(workflowId);
            expect(status?.status).toBe(WorkflowStatus.CANCELLED);
            expect(mockWorkflow.steps[1].rollback).toHaveBeenCalled();
        });
    });

    describe('Event Emission', () => {
        it('should emit step events', async () => {
            const stepStarted = vi.fn();
            const stepCompleted = vi.fn();
            
            workflowEngine.on('workflow:step:started', stepStarted);
            workflowEngine.on('workflow:step:completed', stepCompleted);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            expect(stepStarted).toHaveBeenCalledTimes(3);
            expect(stepCompleted).toHaveBeenCalledTimes(3);
        });

        it('should emit workflow lifecycle events', async () => {
            const lifecycleEvents = {
                created: vi.fn(),
                started: vi.fn(),
                completed: vi.fn()
            };

            workflowEngine.on('workflow:created', lifecycleEvents.created);
            workflowEngine.on('workflow:started', lifecycleEvents.started);
            workflowEngine.on('workflow:completed', lifecycleEvents.completed);

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            expect(lifecycleEvents.created).toHaveBeenCalled();
            expect(lifecycleEvents.started).toHaveBeenCalled();
            expect(lifecycleEvents.completed).toHaveBeenCalled();
        });
    });
});