import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { 
    WorkflowDefinition,
    WorkflowStep,
    WorkflowState,
    WorkflowStatus,
    WorkflowEvent,
    WorkflowCondition,
    WorkflowRollback,
    WorkflowPriority,
    WorkflowExecutionOptions
} from '../types/workflow';
import { WorkflowMetricsService } from './workflowMetrics';
import { EnhancedResourceManager } from './enhancedResourceManager';
import { TaskScheduler } from './taskScheduler';

/**
 * Enhanced workflow engine with distributed execution support
 */
export class WorkflowEngine extends EventEmitter {
    private workflows: Map<string, WorkflowState> = new Map();
    private rollbackHandlers: Map<string, WorkflowRollback> = new Map();
    private metricsService: WorkflowMetricsService;
    private taskScheduler: TaskScheduler;

    constructor(resourceManager: EnhancedResourceManager, taskScheduler: TaskScheduler) {
        super();
        this.metricsService = new WorkflowMetricsService(resourceManager);
        this.taskScheduler = taskScheduler;
        this.setupTaskListeners();
    }

    /**
     * Creates a new workflow instance
     */
    public createWorkflow(
        definition: WorkflowDefinition,
        options: WorkflowExecutionOptions = {}
    ): string {
        const workflowId = uuidv4();
        const state: WorkflowState = {
            id: workflowId,
            definition,
            status: WorkflowStatus.PENDING,
            currentStep: 0,
            steps: [],
            variables: definition.variables || {},
            priority: options.priority || WorkflowPriority.NORMAL,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.workflows.set(workflowId, state);
        this.metricsService.initializeWorkflow(workflowId);
        this.emit('workflow:created', { workflowId, state });
        return workflowId;
    }

    /**
     * Starts workflow execution
     */
    public async startWorkflow(workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        workflow.status = WorkflowStatus.RUNNING;
        workflow.updatedAt = new Date();
        await this.metricsService.updateMetrics(workflowId, workflow);
        this.emit('workflow:started', { workflowId, workflow });

        try {
            await this.executeWorkflow(workflow);
        } catch (error) {
            await this.handleWorkflowError(workflow, error);
        }
    }

    /**
     * Executes workflow steps with distributed resource management
     */
    private async executeWorkflow(workflow: WorkflowState): Promise<void> {
        const { definition } = workflow;
        const maxConcurrent = definition.maxConcurrentSteps || 1;
        const runningSteps = new Set<string>();

        while (workflow.currentStep < definition.steps.length && 
               workflow.status === WorkflowStatus.RUNNING) {
            
            // Get next executable steps (considering dependencies and resource limits)
            const executableSteps = await this.getExecutableSteps(
                workflow,
                maxConcurrent - runningSteps.size
            );

            if (executableSteps.length === 0) {
                // Wait for running steps to complete
                if (runningSteps.size > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }
                // No more steps to execute
                break;
            }

            // Execute steps in parallel if allowed
            const stepPromises = executableSteps.map(step => {
                runningSteps.add(step.id);
                return this.executeStep(step, workflow).finally(() => {
                    runningSteps.delete(step.id);
                });
            });

            try {
                await Promise.all(stepPromises);
                workflow.currentStep += executableSteps.length;
            } catch (error) {
                if (!workflow.definition.continueOnError) {
                    throw error;
                }
                // Log error but continue with next steps
                console.error('Step execution failed:', error);
            }

            workflow.updatedAt = new Date();
            await this.metricsService.updateMetrics(workflow.id, workflow);
        }

        if (workflow.status === WorkflowStatus.RUNNING) {
            workflow.status = WorkflowStatus.COMPLETED;
            workflow.updatedAt = new Date();
            await this.metricsService.updateMetrics(workflow.id, workflow);
            this.emit('workflow:completed', { workflowId: workflow.id, workflow });
        }
    }

    /**
     * Gets executable steps considering dependencies and resources
     */
    private async getExecutableSteps(
        workflow: WorkflowState,
        limit: number
    ): Promise<WorkflowStep[]> {
        const { steps } = workflow.definition;
        const executableSteps: WorkflowStep[] = [];
        const startIndex = workflow.currentStep;

        for (let i = startIndex; i < steps.length && executableSteps.length < limit; i++) {
            const step = steps[i];
            
            // Check dependencies
            if (step.dependencies?.length) {
                const dependenciesMet = step.dependencies.every(depId => {
                    const depStep = workflow.steps.find(s => s.stepId === depId);
                    return depStep?.status === WorkflowStatus.COMPLETED;
                });
                if (!dependenciesMet) continue;
            }

            // Check resource availability
            if (step.resourceRequirements) {
                const canExecute = await this.taskScheduler.canExecuteTask({
                    id: step.id,
                    agentId: 'workflow',
                    priority: step.resourceRequirements.priority || WorkflowPriority.NORMAL,
                    estimatedMemory: step.resourceRequirements.memory,
                    resourceRequirements: {
                        memory: step.resourceRequirements.memory,
                        cpu: step.resourceRequirements.cpu
                    }
                });
                if (!canExecute) continue;
            }

            executableSteps.push(step);
        }

        return executableSteps;
    }

    /**
     * Executes a workflow step
     */
    private async executeStep(step: WorkflowStep, workflow: WorkflowState): Promise<void> {
        // Register rollback handler if provided
        if (step.rollback) {
            this.rollbackHandlers.set(step.id, step.rollback);
        }

        const stepState = {
            stepId: step.id,
            status: WorkflowStatus.RUNNING,
            result: null,
            error: null,
            startedAt: new Date(),
            completedAt: new Date(),
            attempts: 0
        };

        workflow.steps.push(stepState);
        this.emit('workflow:step:started', { workflowId: workflow.id, step });

        try {
            let result;
            if (step.resourceRequirements) {
                // Execute as a distributed task
                result = await this.executeDistributedStep(step, workflow);
            } else {
                // Execute locally
                result = await step.execute(workflow.variables);
            }

            stepState.status = WorkflowStatus.COMPLETED;
            stepState.result = result;
            stepState.completedAt = new Date();

            // Store result in workflow variables if specified
            if (step.outputVariable) {
                workflow.variables[step.outputVariable] = result;
            }

            this.emit('workflow:step:completed', {
                workflowId: workflow.id,
                step,
                result
            });
        } catch (error) {
            stepState.status = WorkflowStatus.FAILED;
            stepState.error = error instanceof Error ? error.message : String(error);
            stepState.completedAt = new Date();

            this.emit('workflow:step:failed', {
                workflowId: workflow.id,
                step,
                error: stepState.error
            });

            if (step.errorHandler) {
                try {
                    await step.errorHandler(error, workflow);
                } catch (handlerError) {
                    console.error('Error handler failed:', handlerError);
                }
            }

            // Handle retries
            if (step.retryPolicy && stepState.attempts < step.retryPolicy.maxAttempts) {
                stepState.attempts++;
                const delay = Math.min(
                    step.retryPolicy.maxDelay,
                    1000 * Math.pow(step.retryPolicy.backoffMultiplier, stepState.attempts - 1)
                );

                this.emit('workflow:step:retrying', {
                    workflowId: workflow.id,
                    step,
                    attempt: stepState.attempts
                });

                await new Promise(resolve => setTimeout(resolve, delay));
                return this.executeStep(step, workflow);
            }

            if (!step.continueOnError) {
                throw error;
            }
        }
    }

    /**
     * Executes a step as a distributed task
     */
    private async executeDistributedStep(
        step: WorkflowStep,
        workflow: WorkflowState
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const taskId = this.taskScheduler.addTask({
                id: step.id,
                agentId: 'workflow',
                priority: step.resourceRequirements?.priority || WorkflowPriority.NORMAL,
                estimatedMemory: step.resourceRequirements?.memory || 0,
                resourceRequirements: {
                    memory: step.resourceRequirements?.memory || 0,
                    cpu: step.resourceRequirements?.cpu || 0,
                    timeoutMs: step.timeout
                },
                distributionPreference: 'any'
            });

            const cleanup = () => {
                this.taskScheduler.removeListener('task:completed', handleComplete);
                this.taskScheduler.removeListener('task:failed', handleError);
            };

            const handleComplete = (task: any) => {
                if (task.id === taskId) {
                    cleanup();
                    resolve(task.result);
                }
            };

            const handleError = (task: any) => {
                if (task.id === taskId) {
                    cleanup();
                    reject(task.error);
                }
            };

            this.taskScheduler.on('task:completed', handleComplete);
            this.taskScheduler.on('task:failed', handleError);
        });
    }

    /**
     * Handles workflow errors and initiates rollback if needed
     */
    private async handleWorkflowError(workflow: WorkflowState, error: unknown): Promise<void> {
        workflow.error = error instanceof Error ? error.message : String(error);
        workflow.updatedAt = new Date();

        if (workflow.definition.rollbackOnError) {
            await this.rollbackWorkflow(workflow);
        } else {
            workflow.status = WorkflowStatus.FAILED;
            await this.metricsService.updateMetrics(workflow.id, workflow);
        }

        this.emit('workflow:failed', {
            workflowId: workflow.id,
            workflow,
            error: workflow.error
        });
    }

    /**
     * Rolls back workflow steps in reverse order
     */
    private async rollbackWorkflow(workflow: WorkflowState): Promise<void> {
        workflow.status = WorkflowStatus.ROLLING_BACK;
        this.emit('workflow:rollback:started', { workflowId: workflow.id });

        // Execute rollback handlers in reverse order
        for (let i = workflow.steps.length - 1; i >= 0; i--) {
            const step = workflow.steps[i];
            const rollbackHandler = this.rollbackHandlers.get(step.stepId);

            if (rollbackHandler) {
                try {
                    await rollbackHandler(workflow.variables);
                    this.emit('workflow:step:rolledback', {
                        workflowId: workflow.id,
                        stepId: step.stepId
                    });
                } catch (error) {
                    console.error(`Rollback failed for step ${step.stepId}:`, error);
                    this.emit('workflow:rollback:failed', {
                        workflowId: workflow.id,
                        stepId: step.stepId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }

        workflow.status = WorkflowStatus.ROLLED_BACK;
        workflow.updatedAt = new Date();
        await this.metricsService.updateMetrics(workflow.id, workflow);
        this.emit('workflow:rollback:completed', { workflowId: workflow.id });
    }

    /**
     * Gets workflow status and progress
     */
    public getWorkflowStatus(workflowId: string): WorkflowState | null {
        return this.workflows.get(workflowId) || null;
    }

    /**
     * Gets workflow metrics
     */
    public getWorkflowMetrics(workflowId: string): any {
        return this.metricsService.getMetrics(workflowId);
    }

    /**
     * Pauses workflow execution
     */
    public async pauseWorkflow(workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        workflow.status = WorkflowStatus.PAUSED;
        workflow.updatedAt = new Date();
        await this.metricsService.updateMetrics(workflow.id, workflow);
        this.emit('workflow:paused', { workflowId, workflow });
    }

    /**
     * Resumes workflow execution
     */
    public async resumeWorkflow(workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        workflow.status = WorkflowStatus.RUNNING;
        workflow.updatedAt = new Date();
        await this.metricsService.updateMetrics(workflow.id, workflow);
        this.emit('workflow:resumed', { workflowId, workflow });

        try {
            await this.executeWorkflow(workflow);
        } catch (error) {
            await this.handleWorkflowError(workflow, error);
        }
    }

    /**
     * Cancels workflow execution
     */
    public async cancelWorkflow(workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        workflow.status = WorkflowStatus.CANCELLED;
        workflow.updatedAt = new Date();
        await this.metricsService.updateMetrics(workflow.id, workflow);
        this.emit('workflow:cancelled', { workflowId, workflow });

        // Cancel any running tasks
        const runningSteps = workflow.steps.filter(s => s.status === WorkflowStatus.RUNNING);
        for (const step of runningSteps) {
            await this.taskScheduler.cancelTask(step.stepId);
        }

        if (workflow.definition.rollbackOnCancel) {
            const originalStatus = workflow.status;
            await this.rollbackWorkflow(workflow);
            workflow.status = originalStatus;
            workflow.updatedAt = new Date();
            await this.metricsService.updateMetrics(workflow.id, workflow);
        }

        this.metricsService.cleanup(workflow.id);
    }

    private setupTaskListeners(): void {
        this.taskScheduler.on('task:started', (task) => {
            this.emit('task:started', task);
        });

        this.taskScheduler.on('task:completed', (task) => {
            this.emit('task:completed', task);
        });

        this.taskScheduler.on('task:failed', (task) => {
            this.emit('task:failed', task);
        });
    }
}