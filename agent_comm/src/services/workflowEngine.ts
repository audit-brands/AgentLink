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
    WorkflowPriority
} from '../types/workflow';
import { WorkflowMetricsService } from './workflowMetrics';
import { EnhancedResourceManager } from './enhancedResourceManager';

/**
 * Enhanced workflow engine with resource monitoring and metrics
 */
export class WorkflowEngine extends EventEmitter {
    private workflows: Map<string, WorkflowState> = new Map();
    private rollbackHandlers: Map<string, WorkflowRollback> = new Map();
    private metricsService: WorkflowMetricsService;

    constructor(resourceManager: EnhancedResourceManager) {
        super();
        this.metricsService = new WorkflowMetricsService(resourceManager);
    }

    /**
     * Creates a new workflow instance
     */
    public createWorkflow(definition: WorkflowDefinition): string {
        const workflowId = uuidv4();
        const state: WorkflowState = {
            id: workflowId,
            definition,
            status: WorkflowStatus.PENDING,
            currentStep: 0,
            steps: [],
            variables: {},
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
     * Executes workflow steps with resource monitoring
     */
    private async executeWorkflow(workflow: WorkflowState): Promise<void> {
        const { definition } = workflow;

        while (workflow.currentStep < definition.steps.length && workflow.status === WorkflowStatus.RUNNING) {
            const step = definition.steps[workflow.currentStep];
            
            try {
                // Check resource requirements
                if (step.resourceRequirements) {
                    const { warnings, critical } = this.metricsService.checkResourceWarnings(workflow.id);
                    
                    for (const warning of warnings) {
                        this.emit('workflow:resource:warning', { 
                            workflowId: workflow.id,
                            message: warning
                        });
                    }

                    for (const criticalError of critical) {
                        this.emit('workflow:resource:critical', {
                            workflowId: workflow.id,
                            message: criticalError
                        });
                        
                        if (step.resourceRequirements.priority !== WorkflowPriority.CRITICAL) {
                            throw new Error(`Resource limits exceeded: ${criticalError}`);
                        }
                    }
                }

                // Check step conditions
                if (step.condition && !await this.evaluateCondition(step.condition, workflow)) {
                    workflow.currentStep++;
                    continue;
                }

                // Execute step
                const result = await this.executeStep(step, workflow);
                workflow.steps.push({
                    stepId: step.id,
                    status: WorkflowStatus.COMPLETED,
                    result,
                    error: null,
                    startedAt: new Date(),
                    completedAt: new Date()
                });

                // Store result in workflow variables if specified
                if (step.outputVariable) {
                    workflow.variables[step.outputVariable] = result;
                }

                workflow.currentStep++;
                workflow.updatedAt = new Date();
                await this.metricsService.updateMetrics(workflow.id, workflow);
                this.emit('workflow:step:completed', { workflowId: workflow.id, step, result });

            } catch (error) {
                const stepState = {
                    stepId: step.id,
                    status: WorkflowStatus.FAILED,
                    result: null,
                    error: error instanceof Error ? error.message : String(error),
                    startedAt: new Date(),
                    completedAt: new Date()
                };
                workflow.steps.push(stepState);
                
                this.emit('workflow:step:failed', { 
                    workflowId: workflow.id, 
                    step,
                    error: stepState.error
                });

                // Handle step failure
                if (step.errorHandler) {
                    try {
                        await step.errorHandler(error, workflow);
                    } catch (handlerError) {
                        console.error('Error handler failed:', handlerError);
                    }
                }

                // Retry logic
                if (step.retryPolicy && (!step.attempts || step.attempts < step.retryPolicy.maxAttempts)) {
                    step.attempts = (step.attempts || 0) + 1;
                    const delay = Math.min(
                        step.retryPolicy.maxDelay,
                        1000 * Math.pow(step.retryPolicy.backoffMultiplier, step.attempts - 1)
                    );
                    
                    this.emit('workflow:step:retrying', {
                        workflowId: workflow.id,
                        step,
                        attempt: step.attempts
                    });

                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (step.continueOnError) {
                    workflow.currentStep++;
                    continue;
                }

                throw error;
            }
        }

        if (workflow.status === WorkflowStatus.RUNNING) {
            // Only complete if not cancelled or failed
            workflow.status = WorkflowStatus.COMPLETED;
            workflow.updatedAt = new Date();
            await this.metricsService.updateMetrics(workflow.id, workflow);
            this.workflows.set(workflow.id, workflow);
            this.emit('workflow:completed', { workflowId: workflow.id, workflow });
        }
    }

    /**
     * Evaluates workflow conditions
     */
    private async evaluateCondition(condition: WorkflowCondition, workflow: WorkflowState): Promise<boolean> {
        try {
            return await condition(workflow.variables);
        } catch (error) {
            console.error('Condition evaluation failed:', error);
            return false;
        }
    }

    /**
     * Executes a single workflow step
     */
    private async executeStep(step: WorkflowStep, workflow: WorkflowState): Promise<unknown> {
        // Register rollback handler if provided
        if (step.rollback) {
            this.rollbackHandlers.set(step.id, step.rollback);
        }

        try {
            this.emit('workflow:step:started', { workflowId: workflow.id, step });
            return await step.execute(workflow.variables);
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handles workflow errors and initiates rollback if needed
     */
    private async handleWorkflowError(workflow: WorkflowState, error: unknown): Promise<void> {
        workflow.error = error instanceof Error ? error.message : String(error);
        workflow.updatedAt = new Date();

        // Initiate rollback if enabled
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

        // Initiate rollback if enabled
        if (workflow.definition.rollbackOnCancel) {
            const originalStatus = workflow.status;
            await this.rollbackWorkflow(workflow);
            workflow.status = originalStatus; // Restore CANCELLED status after rollback
            workflow.updatedAt = new Date();
            await this.metricsService.updateMetrics(workflow.id, workflow);
        }

        this.metricsService.cleanup(workflow.id);
    }
}