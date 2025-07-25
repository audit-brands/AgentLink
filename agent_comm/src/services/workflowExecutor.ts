import { EventEmitter } from 'events';
import { WorkflowTask, WorkflowState, WorkflowEvents } from '../models/workflow';
import { EnhancedResourceManager } from './enhancedResourceManager';

export class WorkflowExecutor extends EventEmitter {
    private resourceManager: EnhancedResourceManager;
    private workflowEvents: WorkflowEvents;
    private activeExecutions: Map<string, NodeJS.Timeout>;
    private taskTimeouts: Map<string, NodeJS.Timeout>;

    constructor(resourceManager: EnhancedResourceManager) {
        super();
        this.resourceManager = resourceManager;
        this.workflowEvents = new WorkflowEvents();
        this.activeExecutions = new Map();
        this.taskTimeouts = new Map();

        // Forward workflow events
        Object.values(WorkflowEvents).forEach(event => {
            if (typeof event === 'string') {
                this.workflowEvents.on(event, (...args) => this.emit(event, ...args));
            }
        });
    }

    /**
     * Execute a single task with resource management and timeout handling
     */
    async executeTask(
        workflowId: string,
        task: WorkflowTask,
        state: WorkflowState
    ): Promise<any> {
        const taskState = state.tasks[task.id];
        
        if (taskState.status === 'completed') {
            return taskState.result;
        }

        // Check resource availability
        if (task.resourceRequirements) {
            const canExecute = await this.resourceManager.canHandleTask(task.resourceRequirements);
            if (!canExecute) {
                throw new Error(`Insufficient resources for task ${task.id}`);
            }
            await this.resourceManager.reserveResources(task.id, task.resourceRequirements);
        }

        try {
            this.workflowEvents.emitTaskStarted(workflowId, task.id);
            
            // Set task timeout if specified
            if (task.timeout) {
                this.setTaskTimeout(workflowId, task.id, task.timeout);
            }

            // Execute task based on type
            const result = await this.executeTaskByType(task);
            
            // Clear timeout
            this.clearTaskTimeout(task.id);
            
            // Release resources
            if (task.resourceRequirements) {
                this.resourceManager.releaseResources(task.id);
            }

            this.workflowEvents.emitTaskCompleted(workflowId, task.id, result);
            return result;
        } catch (error) {
            // Clear timeout
            this.clearTaskTimeout(task.id);
            
            // Release resources
            if (task.resourceRequirements) {
                this.resourceManager.releaseResources(task.id);
            }

            this.workflowEvents.emitTaskFailed(workflowId, task.id, error as Error);
            throw error;
        }
    }

    /**
     * Execute a task based on its type
     */
    private async executeTaskByType(task: WorkflowTask): Promise<any> {
        switch (task.type) {
            case 'agent':
                return this.executeAgentTask(task);
            case 'http':
                return this.executeHttpTask(task);
            case 'function':
                return this.executeFunctionTask(task);
            default:
                throw new Error(`Unknown task type: ${task.type}`);
        }
    }

    /**
     * Execute a task that involves an agent
     */
    private async executeAgentTask(task: WorkflowTask): Promise<any> {
        // TODO: Implement agent task execution
        throw new Error('Agent task execution not implemented');
    }

    /**
     * Execute a task that makes an HTTP request
     */
    private async executeHttpTask(task: WorkflowTask): Promise<any> {
        // TODO: Implement HTTP task execution
        throw new Error('HTTP task execution not implemented');
    }

    /**
     * Execute a task that runs a function
     */
    private async executeFunctionTask(task: WorkflowTask): Promise<any> {
        if (typeof task.params.function !== 'function') {
            throw new Error('Function task requires a function parameter');
        }
        return task.params.function(task.params);
    }

    /**
     * Set a timeout for a task
     */
    private setTaskTimeout(workflowId: string, taskId: string, timeout: number): void {
        const timeoutId = setTimeout(() => {
            this.workflowEvents.emitTaskFailed(
                workflowId,
                taskId,
                new Error(`Task ${taskId} timed out after ${timeout}ms`)
            );
            this.resourceManager.releaseResources(taskId);
        }, timeout);

        this.taskTimeouts.set(taskId, timeoutId);
    }

    /**
     * Clear a task timeout
     */
    private clearTaskTimeout(taskId: string): void {
        const timeoutId = this.taskTimeouts.get(taskId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.taskTimeouts.delete(taskId);
        }
    }

    /**
     * Stop all active executions
     */
    stop(): void {
        // Clear all task timeouts
        this.taskTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.taskTimeouts.clear();

        // Clear all workflow timeouts
        this.activeExecutions.forEach((timeoutId) => clearTimeout(timeoutId));
        this.activeExecutions.clear();
    }
}