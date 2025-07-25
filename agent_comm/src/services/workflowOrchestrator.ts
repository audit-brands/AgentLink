import { EventEmitter } from 'events';
import {
    WorkflowDefinition,
    WorkflowState,
    WorkflowResult,
    WorkflowEvents
} from '../models/workflow';
import { WorkflowExecutor } from './workflowExecutor';
import { EnhancedResourceManager } from './enhancedResourceManager';

export class WorkflowOrchestrator extends EventEmitter {
    private workflows: Map<string, WorkflowDefinition>;
    private workflowStates: Map<string, WorkflowState>;
    private executor: WorkflowExecutor;
    private workflowEvents: WorkflowEvents;

    constructor(resourceManager: EnhancedResourceManager) {
        super();
        this.workflows = new Map();
        this.workflowStates = new Map();
        this.executor = new WorkflowExecutor(resourceManager);
        this.workflowEvents = new WorkflowEvents();

        // Forward all workflow events
        Object.values(WorkflowEvents).forEach(event => {
            if (typeof event === 'string') {
                this.workflowEvents.on(event, (...args) => this.emit(event, ...args));
            }
        });
    }

    /**
     * Register a new workflow definition
     */
    registerWorkflow(workflow: WorkflowDefinition): void {
        if (this.workflows.has(workflow.id)) {
            throw new Error(`Workflow with ID ${workflow.id} already exists`);
        }
        this.validateWorkflow(workflow);
        this.workflows.set(workflow.id, workflow);
    }

    /**
     * Start execution of a workflow
     */
    async startWorkflow(workflowId: string, params?: Record<string, any>): Promise<string> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        const state: WorkflowState = {
            workflowId,
            status: 'pending',
            tasks: {},
            startTime: Date.now()
        };

        // Initialize task states
        workflow.tasks.forEach(task => {
            state.tasks[task.id] = {
                status: 'pending',
                attempts: 0
            };
        });

        this.workflowStates.set(workflowId, state);
        this.workflowEvents.emitWorkflowStarted(workflowId);

        // Start workflow execution
        this.executeWorkflow(workflow, state, params).catch(error => {
            state.status = 'failed';
            state.error = error.message;
            state.endTime = Date.now();
            this.workflowEvents.emitWorkflowFailed(workflowId, error);
        });

        return workflowId;
    }

    /**
     * Pause a running workflow
     */
    pauseWorkflow(workflowId: string): void {
        const state = this.workflowStates.get(workflowId);
        if (!state) {
            throw new Error(`Workflow ${workflowId} not found`);
        }
        if (state.status === 'running') {
            state.status = 'paused';
            this.workflowEvents.emitWorkflowPaused(workflowId);
        }
    }

    /**
     * Resume a paused workflow
     */
    async resumeWorkflow(workflowId: string): Promise<void> {
        const state = this.workflowStates.get(workflowId);
        if (!state) {
            throw new Error(`Workflow ${workflowId} not found`);
        }
        if (state.status === 'paused') {
            state.status = 'running';
            this.workflowEvents.emitWorkflowResumed(workflowId);
            const workflow = this.workflows.get(workflowId);
            if (workflow) {
                await this.executeWorkflow(workflow, state);
            }
        }
    }

    /**
     * Get the current state of a workflow
     */
    getWorkflowState(workflowId: string): WorkflowState | undefined {
        return this.workflowStates.get(workflowId);
    }

    /**
     * Execute a workflow with dependency management
     */
    private async executeWorkflow(
        workflow: WorkflowDefinition,
        state: WorkflowState,
        params?: Record<string, any>
    ): Promise<void> {
        state.status = 'running';
        
        try {
            // Create execution groups based on dependencies
            const executionGroups = this.createExecutionGroups(workflow);
            
            // Execute groups sequentially, tasks within groups in parallel
            for (const group of executionGroups) {
                if (state.status === 'paused') {
                    return;
                }

                await Promise.all(
                    group.map(task => {
                        const enrichedTask = {
                            ...task,
                            params: { ...task.params, ...params }
                        };
                        return this.executor.executeTask(workflow.id, enrichedTask, state)
                            .then(result => {
                                state.tasks[task.id].status = 'completed';
                                state.tasks[task.id].result = result;
                                state.tasks[task.id].endTime = Date.now();
                            })
                            .catch(error => {
                                state.tasks[task.id].status = 'failed';
                                state.tasks[task.id].error = error.message;
                                state.tasks[task.id].endTime = Date.now();
                                
                                if (!workflow.errorHandling?.continueOnError) {
                                    throw error;
                                }
                            });
                    })
                );
            }

            // Workflow completed successfully
            state.status = 'completed';
            state.endTime = Date.now();
            
            const result: WorkflowResult = {
                workflowId: workflow.id,
                status: 'completed',
                tasks: Object.fromEntries(
                    Object.entries(state.tasks).map(([id, task]) => [
                        id,
                        {
                            status: task.status === 'completed' ? 'completed' : 'failed',
                            result: task.result,
                            error: task.error
                        }
                    ])
                ),
                startTime: state.startTime,
                endTime: state.endTime
            };

            this.workflowEvents.emitWorkflowCompleted(workflow.id, result);
        } catch (error) {
            state.status = 'failed';
            state.error = error.message;
            state.endTime = Date.now();
            this.workflowEvents.emitWorkflowFailed(workflow.id, error as Error);
            throw error;
        }
    }

    /**
     * Create execution groups based on task dependencies
     */
    private createExecutionGroups(workflow: WorkflowDefinition): Array<Array<WorkflowDefinition['tasks'][0]>> {
        const groups: Array<Array<WorkflowDefinition['tasks'][0]>> = [];
        const completed = new Set<string>();
        const remaining = new Set(workflow.tasks.map(t => t.id));

        while (remaining.size > 0) {
            const group = workflow.tasks.filter(task => {
                if (!remaining.has(task.id)) return false;
                
                // Check if all dependencies are completed
                const depsCompleted = !task.dependencies?.length ||
                    task.dependencies.every(dep => completed.has(dep));
                
                return depsCompleted;
            });

            if (group.length === 0 && remaining.size > 0) {
                throw new Error('Circular dependency detected in workflow');
            }

            groups.push(group);
            group.forEach(task => {
                completed.add(task.id);
                remaining.delete(task.id);
            });
        }

        return groups;
    }

    /**
     * Validate a workflow definition
     */
    private validateWorkflow(workflow: WorkflowDefinition): void {
        if (!workflow.id || !workflow.name || !workflow.tasks?.length) {
            throw new Error('Invalid workflow definition: missing required fields');
        }

        // Check for duplicate task IDs
        const taskIds = new Set<string>();
        workflow.tasks.forEach(task => {
            if (taskIds.has(task.id)) {
                throw new Error(`Duplicate task ID found: ${task.id}`);
            }
            taskIds.add(task.id);
        });

        // Validate dependencies
        workflow.tasks.forEach(task => {
            task.dependencies?.forEach(depId => {
                if (!taskIds.has(depId)) {
                    throw new Error(`Task ${task.id} depends on non-existent task ${depId}`);
                }
            });
        });

        // Check for circular dependencies
        this.createExecutionGroups(workflow); // This will throw if circular dependencies are found
    }

    /**
     * Stop the orchestrator and cleanup
     */
    stop(): void {
        this.executor.stop();
    }
}