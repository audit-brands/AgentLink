import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEvents } from '../models/workflow';

describe('WorkflowEvents', () => {
    let events: WorkflowEvents;
    const workflowId = 'test-workflow';
    const taskId = 'test-task';

    beforeEach(() => {
        events = new WorkflowEvents();
    });

    describe('Task Events', () => {
        it('should emit task started event', async () => {
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.TASK_STARTED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.taskId).toBe(taskId);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitTaskStarted(workflowId, taskId);
            await promise;
        });

        it('should emit task completed event with result', async () => {
            const result = { value: 'test' };
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.TASK_COMPLETED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.taskId).toBe(taskId);
                    expect(data.result).toEqual(result);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitTaskCompleted(workflowId, taskId, result);
            await promise;
        });

        it('should emit task failed event with error', async () => {
            const error = new Error('Test error');
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.TASK_FAILED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.taskId).toBe(taskId);
                    expect(data.error).toBe(error);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitTaskFailed(workflowId, taskId, error);
            await promise;
        });
    });

    describe('Workflow Events', () => {
        it('should emit workflow started event', async () => {
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.WORKFLOW_STARTED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitWorkflowStarted(workflowId);
            await promise;
        });

        it('should emit workflow completed event with result', async () => {
            const result = {
                workflowId,
                status: 'completed' as const,
                tasks: {},
                startTime: Date.now(),
                endTime: Date.now()
            };

            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.WORKFLOW_COMPLETED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.result).toEqual(result);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitWorkflowCompleted(workflowId, result);
            await promise;
        });

        it('should emit workflow failed event with error', async () => {
            const error = new Error('Test error');
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.WORKFLOW_FAILED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.error).toBe(error);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitWorkflowFailed(workflowId, error);
            await promise;
        });

        it('should emit workflow paused event', async () => {
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.WORKFLOW_PAUSED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitWorkflowPaused(workflowId);
            await promise;
        });

        it('should emit workflow resumed event', async () => {
            const promise = new Promise<void>(resolve => {
                events.once(WorkflowEvents.WORKFLOW_RESUMED, (data) => {
                    expect(data.workflowId).toBe(workflowId);
                    expect(data.timestamp).toBeDefined();
                    resolve();
                });
            });

            events.emitWorkflowResumed(workflowId);
            await promise;
        });
    });

    describe('Event Propagation', () => {
        it('should allow multiple listeners for the same event', () => {
            let count = 0;
            const handler = () => count++;

            events.on(WorkflowEvents.WORKFLOW_STARTED, handler);
            events.on(WorkflowEvents.WORKFLOW_STARTED, handler);

            events.emitWorkflowStarted(workflowId);
            expect(count).toBe(2);
        });

        it('should handle removal of event listeners', () => {
            let count = 0;
            const handler = () => count++;

            events.on(WorkflowEvents.WORKFLOW_STARTED, handler);
            events.emitWorkflowStarted(workflowId);
            expect(count).toBe(1);

            events.removeListener(WorkflowEvents.WORKFLOW_STARTED, handler);
            events.emitWorkflowStarted(workflowId);
            expect(count).toBe(1);
        });

        it('should not leak memory when adding and removing listeners', () => {
            const initialListenerCount = events.listenerCount(WorkflowEvents.WORKFLOW_STARTED);
            const handler = () => {};

            // Add and remove listeners multiple times
            for (let i = 0; i < 100; i++) {
                events.on(WorkflowEvents.WORKFLOW_STARTED, handler);
                events.removeListener(WorkflowEvents.WORKFLOW_STARTED, handler);
            }

            expect(events.listenerCount(WorkflowEvents.WORKFLOW_STARTED))
                .toBe(initialListenerCount);
        });
    });
});