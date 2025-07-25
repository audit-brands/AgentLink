import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkflowOrchestrator } from '../services/workflowOrchestrator';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { WorkflowDefinition, WorkflowEvents } from '../models/workflow';

describe('WorkflowOrchestrator', () => {
    let orchestrator: WorkflowOrchestrator;
    let resourceManager: EnhancedResourceManager;

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager({
            memory: { max: 1024 * 1024 * 1024, warning: 768 * 1024 * 1024 },
            cpu: { maxUsage: 80, warning: 70 }
        });
        orchestrator = new WorkflowOrchestrator(resourceManager);
    });

    afterEach(() => {
        orchestrator.stop();
        resourceManager.stop();
    });

    describe('Workflow Registration', () => {
        it('should register a valid workflow', () => {
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => 'result'
                        }
                    }
                ]
            };

            expect(() => orchestrator.registerWorkflow(workflow)).not.toThrow();
        });

        it('should reject duplicate workflow registration', () => {
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => 'result'
                        }
                    }
                ]
            };

            orchestrator.registerWorkflow(workflow);
            expect(() => orchestrator.registerWorkflow(workflow)).toThrow();
        });

        it('should validate workflow dependencies', () => {
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => 'result'
                        },
                        dependencies: ['non-existent']
                    }
                ]
            };

            expect(() => orchestrator.registerWorkflow(workflow)).toThrow();
        });
    });

    describe('Workflow Execution', () => {
        it('should execute tasks in correct order', async () => {
            const executionOrder: string[] = [];
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => {
                                executionOrder.push('task1');
                                return 'result1';
                            }
                        }
                    },
                    {
                        id: 'task2',
                        type: 'function',
                        params: {
                            function: () => {
                                executionOrder.push('task2');
                                return 'result2';
                            }
                        },
                        dependencies: ['task1']
                    }
                ]
            };

            orchestrator.registerWorkflow(workflow);
            await orchestrator.startWorkflow(workflow.id);

            expect(executionOrder).toEqual(['task1', 'task2']);
        });

        it('should handle task failures appropriately', async () => {
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => {
                                throw new Error('Task failed');
                            }
                        }
                    }
                ]
            };

            orchestrator.registerWorkflow(workflow);
            await orchestrator.startWorkflow(workflow.id);

            const state = orchestrator.getWorkflowState(workflow.id);
            expect(state?.status).toBe('failed');
            expect(state?.tasks['task1'].status).toBe('failed');
        });

        it('should respect workflow timeout', async () => {
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                timeout: 100,
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => new Promise(resolve => setTimeout(resolve, 200))
                        }
                    }
                ]
            };

            orchestrator.registerWorkflow(workflow);
            await orchestrator.startWorkflow(workflow.id);

            const state = orchestrator.getWorkflowState(workflow.id);
            expect(state?.status).toBe('failed');
        });
    });

    describe('Workflow Control', () => {
        it('should pause and resume workflow execution', async () => {
            const executionOrder: string[] = [];
            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => {
                                executionOrder.push('task1');
                                return 'result1';
                            }
                        }
                    },
                    {
                        id: 'task2',
                        type: 'function',
                        params: {
                            function: () => {
                                executionOrder.push('task2');
                                return 'result2';
                            }
                        }
                    }
                ]
            };

            orchestrator.registerWorkflow(workflow);
            const workflowId = await orchestrator.startWorkflow(workflow.id);
            
            orchestrator.pauseWorkflow(workflowId);
            expect(orchestrator.getWorkflowState(workflowId)?.status).toBe('paused');

            await orchestrator.resumeWorkflow(workflowId);
            expect(orchestrator.getWorkflowState(workflowId)?.status).toBe('completed');
            expect(executionOrder).toEqual(['task1', 'task2']);
        });
    });

    describe('Event Emission', () => {
        it('should emit workflow lifecycle events', async () => {
            const events: string[] = [];
            Object.values(WorkflowEvents).forEach(event => {
                if (typeof event === 'string') {
                    orchestrator.on(event, () => events.push(event));
                }
            });

            const workflow: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test Workflow',
                tasks: [
                    {
                        id: 'task1',
                        type: 'function',
                        params: {
                            function: () => 'result'
                        }
                    }
                ]
            };

            orchestrator.registerWorkflow(workflow);
            await orchestrator.startWorkflow(workflow.id);

            expect(events).toContain(WorkflowEvents.WORKFLOW_STARTED);
            expect(events).toContain(WorkflowEvents.TASK_STARTED);
            expect(events).toContain(WorkflowEvents.TASK_COMPLETED);
            expect(events).toContain(WorkflowEvents.WORKFLOW_COMPLETED);
        });
    });
});