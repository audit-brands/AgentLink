import { EventEmitter } from 'events';

export interface WorkflowTask {
    id: string;
    type: string;
    params: Record<string, any>;
    dependencies?: string[];
    timeout?: number;
    retries?: number;
    resourceRequirements?: {
        memory: number;
        cpu: number;
    };
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    description?: string;
    tasks: WorkflowTask[];
    timeout?: number;
    maxConcurrency?: number;
    errorHandling?: {
        continueOnError?: boolean;
        retryPolicy?: {
            maxAttempts: number;
            backoffMultiplier: number;
            initialDelay: number;
        };
    };
}

export interface WorkflowState {
    workflowId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
    tasks: {
        [taskId: string]: {
            status: 'pending' | 'running' | 'completed' | 'failed';
            attempts: number;
            startTime?: number;
            endTime?: number;
            error?: string;
            result?: any;
        };
    };
    startTime: number;
    endTime?: number;
    error?: string;
}

export interface WorkflowResult {
    workflowId: string;
    status: 'completed' | 'failed';
    tasks: {
        [taskId: string]: {
            status: 'completed' | 'failed';
            result?: any;
            error?: string;
        };
    };
    startTime: number;
    endTime: number;
    error?: string;
}

export class WorkflowEvents extends EventEmitter {
    static readonly TASK_STARTED = 'taskStarted';
    static readonly TASK_COMPLETED = 'taskCompleted';
    static readonly TASK_FAILED = 'taskFailed';
    static readonly WORKFLOW_STARTED = 'workflowStarted';
    static readonly WORKFLOW_COMPLETED = 'workflowCompleted';
    static readonly WORKFLOW_FAILED = 'workflowFailed';
    static readonly WORKFLOW_PAUSED = 'workflowPaused';
    static readonly WORKFLOW_RESUMED = 'workflowResumed';

    emitTaskStarted(workflowId: string, taskId: string): void {
        this.emit(WorkflowEvents.TASK_STARTED, { workflowId, taskId, timestamp: Date.now() });
    }

    emitTaskCompleted(workflowId: string, taskId: string, result: any): void {
        this.emit(WorkflowEvents.TASK_COMPLETED, {
            workflowId,
            taskId,
            result,
            timestamp: Date.now()
        });
    }

    emitTaskFailed(workflowId: string, taskId: string, error: Error): void {
        this.emit(WorkflowEvents.TASK_FAILED, {
            workflowId,
            taskId,
            error,
            timestamp: Date.now()
        });
    }

    emitWorkflowStarted(workflowId: string): void {
        this.emit(WorkflowEvents.WORKFLOW_STARTED, { workflowId, timestamp: Date.now() });
    }

    emitWorkflowCompleted(workflowId: string, result: WorkflowResult): void {
        this.emit(WorkflowEvents.WORKFLOW_COMPLETED, {
            workflowId,
            result,
            timestamp: Date.now()
        });
    }

    emitWorkflowFailed(workflowId: string, error: Error): void {
        this.emit(WorkflowEvents.WORKFLOW_FAILED, {
            workflowId,
            error,
            timestamp: Date.now()
        });
    }

    emitWorkflowPaused(workflowId: string): void {
        this.emit(WorkflowEvents.WORKFLOW_PAUSED, { workflowId, timestamp: Date.now() });
    }

    emitWorkflowResumed(workflowId: string): void {
        this.emit(WorkflowEvents.WORKFLOW_RESUMED, { workflowId, timestamp: Date.now() });
    }
}