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
import { EnhancedTaskRouter } from './enhancedTaskRouter';
import { ResourceManager } from './resourceManager';

interface StepExecutionMetrics {
    attempts: number;
    duration: number;
    resourceUsage: {
        cpu: number;
        memory: number;
    };
}

interface WorkflowExecutionPlan {
    parallelSteps: WorkflowStep[][];
    estimatedDuration: number;
    resourceRequirements: {
        cpu: number;
        memory: number;
    };
}

/**
 * Enhanced workflow engine with advanced orchestration capabilities
 */
export class EnhancedWorkflowEngine extends EventEmitter {
    private workflows: Map<string, WorkflowState> = new Map();
    private rollbackHandlers: Map<string, WorkflowRollback> = new Map();
    private executionMetrics: Map<string, Map<string, StepExecutionMetrics>> = new Map();
    private activeWorkflows: Set<string> = new Set();
    private workflowQueue: Array<{ id: string; priority: WorkflowPriority }> = [];
    private maxConcurrentWorkflows: number;

    constructor(
        private taskRouter: EnhancedTaskRouter,
        private resourceManager: ResourceManager,
        private config: {
            maxConcurrentWorkflows: number;
            maxRetryAttempts: number;
            resourceThreshold: number;
            planningInterval: number;
        }
    ) {
        super();
        this.maxConcurrentWorkflows = config.maxConcurrentWorkflows;
        this.startWorkflowPlanner();
    }

    /**
     * Creates a new workflow instance with priority
     */
    public createWorkflow(
        definition: WorkflowDefinition,
        priority: WorkflowPriority = WorkflowPriority.NORMAL
    ): string {
        const workflowId = uuidv4();
        const state: WorkflowState = {
            id: workflowId,
            definition,
            status: WorkflowStatus.PENDING,
            currentStep: 0,
            steps: [],
            variables: {},
            priority,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.workflows.set(workflowId, state);
        this.workflowQueue.push({ id: workflowId, priority });
        this.sortWorkflowQueue();
        
        this.emit('workflow:created', { workflowId, state });
        return workflowId;
    }

    private sortWorkflowQueue(): void {
        this.workflowQueue.sort((a, b) => {
            // Sort by priority first
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            
            // Then by creation time
            const workflowA = this.workflows.get(a.id);
            const workflowB = this.workflows.get(b.id);
            return (workflowA?.createdAt?.getTime() || 0) - 
                   (workflowB?.createdAt?.getTime() || 0);
        });
    }

    private startWorkflowPlanner(): void {
        setInterval(() => {
            this.planAndExecuteWorkflows();
        }, this.config.planningInterval);
    }

    private async planAndExecuteWorkflows(): Promise<void> {
        if (this.activeWorkflows.size >= this.maxConcurrentWorkflows) {
            return;
        }

        // Get resource availability
        const availableResources = await this.resourceManager.getAvailableResources();
        
        // Try to start workflows from the queue
        while (this.workflowQueue.length > 0 && 
               this.activeWorkflows.size < this.maxConcurrentWorkflows) {
            
            const nextWorkflow = this.workflowQueue[0];
            const workflow = this.workflows.get(nextWorkflow.id);
            
            if (!workflow) {
                this.workflowQueue.shift();
                continue;
            }

            // Plan workflow execution
            const plan = await this.createExecutionPlan(workflow);
            
            // Check if we have enough resources
            if (plan.resourceRequirements.cpu > availableResources.cpu ||
                plan.resourceRequirements.memory > availableResources.memory) {
                break; // Wait for more resources
            }

            // Start workflow execution
            this.workflowQueue.shift();
            this.activeWorkflows.add(workflow.id);
            
            this.startWorkflow(workflow.id).catch(error => {
                console.error(`Failed to start workflow ${workflow.id}:`, error);
                this.activeWorkflows.delete(workflow.id);
            });
        }
    }

    private async createExecutionPlan(workflow: WorkflowState): Promise<WorkflowExecutionPlan> {
        const { definition } = workflow;
        const plan: WorkflowExecutionPlan = {
            parallelSteps: [],
            estimatedDuration: 0,
            resourceRequirements: { cpu: 0, memory: 0 }
        };

        let currentParallelGroup: WorkflowStep[] = [];
        let maxResourceUsage = { cpu: 0, memory: 0 };

        for (const step of definition.steps) {
            // Get step metrics if available
            const stepMetrics = this.getStepMetrics(workflow.id, step.id);
            
            // Calculate resource requirements
            const stepResources = {
                cpu: stepMetrics?.resourceUsage.cpu || 0.1, // Default 10% CPU
                memory: stepMetrics?.resourceUsage.memory || 0.1 // Default 10% memory
            };

            // Check if step can run in parallel
            if (step.parallel && 
                maxResourceUsage.cpu + stepResources.cpu <= this.config.resourceThreshold &&
                maxResourceUsage.memory + stepResources.memory <= this.config.resourceThreshold) {
                
                currentParallelGroup.push(step);
                maxResourceUsage.cpu = Math.max(maxResourceUsage.cpu, stepResources.cpu);
                maxResourceUsage.memory = Math.max(maxResourceUsage.memory, stepResources.memory);
                
            } else {
                // Start new parallel group
                if (currentParallelGroup.length > 0) {
                    plan.parallelSteps.push(currentParallelGroup);
                }
                currentParallelGroup = [step];
                maxResourceUsage = stepResources;
            }

            // Update total resource requirements
            plan.resourceRequirements.cpu = Math.max(
                plan.resourceRequirements.cpu,
                maxResourceUsage.cpu
            );
            plan.resourceRequirements.memory = Math.max(
                plan.resourceRequirements.memory,
                maxResourceUsage.memory
            );

            // Add step duration to total
            plan.estimatedDuration += stepMetrics?.duration || 1000; // Default 1s
        }

        // Add final parallel group
        if (currentParallelGroup.length > 0) {
            plan.parallelSteps.push(currentParallelGroup);
        }

        return plan;
    }

    /**
     * Starts workflow execution with improved orchestration
     */
    public async startWorkflow(workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        workflow.status = WorkflowStatus.RUNNING;
        workflow.updatedAt = new Date();
        this.emit('workflow:started', { workflowId, workflow });

        try {
            const plan = await this.createExecutionPlan(workflow);
            await this.executeWorkflowWithPlan(workflow, plan);
        } catch (error) {
            await this.handleWorkflowError(workflow, error);
        } finally {
            this.activeWorkflows.delete(workflowId);
        }
    }

    /**
     * Executes workflow according to execution plan
     */
    private async executeWorkflowWithPlan(
        workflow: WorkflowState,
        plan: WorkflowExecutionPlan
    ): Promise<void> {
        for (const parallelSteps of plan.parallelSteps) {
            // Execute steps in parallel
            await Promise.all(parallelSteps.map(async step => {
                const startTime = Date.now();
                
                try {
                    // Check step conditions
                    if (step.condition && !await this.evaluateCondition(step.condition, workflow)) {
                        return;
                    }

                    // Execute step with retries
                    const result = await this.executeStepWithRetries(step, workflow);
                    
                    // Record metrics
                    this.recordStepMetrics(workflow.id, step.id, {
                        attempts: 1,
                        duration: Date.now() - startTime,
                        resourceUsage: await this.getStepResourceUsage()
                    });

                    // Store result
                    workflow.steps.push({
                        stepId: step.id,
                        status: WorkflowStatus.COMPLETED,
                        result,
                        error: null,
                        startedAt: new Date(startTime),
                        completedAt: new Date()
                    });

                    if (step.outputVariable) {
                        workflow.variables[step.outputVariable] = result;
                    }

                    this.emit('workflow:step:completed', { 
                        workflowId: workflow.id,
                        step,
                        result
                    });

                } catch (error) {
                    if (!step.continueOnError) {
                        throw error;
                    }

                    // Record failure metrics
                    this.recordStepMetrics(workflow.id, step.id, {
                        attempts: this.config.maxRetryAttempts,
                        duration: Date.now() - startTime,
                        resourceUsage: await this.getStepResourceUsage()
                    });

                    workflow.steps.push({
                        stepId: step.id,
                        status: WorkflowStatus.FAILED,
                        result: null,
                        error: error instanceof Error ? error.message : String(error),
                        startedAt: new Date(startTime),
                        completedAt: new Date()
                    });

                    this.emit('workflow:step:failed', {
                        workflowId: workflow.id,
                        step,
                        error: workflow.steps[workflow.steps.length - 1].error
                    });
                }
            }));
        }

        // Workflow completed successfully
        workflow.status = WorkflowStatus.COMPLETED;
        workflow.updatedAt = new Date();
        this.workflows.set(workflow.id, workflow);
        this.emit('workflow:completed', { workflowId: workflow.id, workflow });
    }

    private async executeStepWithRetries(
        step: WorkflowStep,
        workflow: WorkflowState,
        attempt: number = 1
    ): Promise<unknown> {
        try {
            return await this.executeStep(step, workflow);
        } catch (error) {
            if (attempt >= this.config.maxRetryAttempts) {
                throw error;
            }

            // Exponential backoff
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
            await new Promise(resolve => setTimeout(resolve, delay));

            return this.executeStepWithRetries(step, workflow, attempt + 1);
        }
    }

    private async getStepResourceUsage(): Promise<{ cpu: number; memory: number }> {
        const metrics = await this.resourceManager.getMetrics();
        return {
            cpu: metrics.cpu.current / 100,
            memory: metrics.memory.current / metrics.memory.max
        };
    }

    private getStepMetrics(
        workflowId: string,
        stepId: string
    ): StepExecutionMetrics | undefined {
        return this.executionMetrics.get(workflowId)?.get(stepId);
    }

    private recordStepMetrics(
        workflowId: string,
        stepId: string,
        metrics: StepExecutionMetrics
    ): void {
        let workflowMetrics = this.executionMetrics.get(workflowId);
        if (!workflowMetrics) {
            workflowMetrics = new Map();
            this.executionMetrics.set(workflowId, workflowMetrics);
        }
        workflowMetrics.set(stepId, metrics);
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
        workflow.status = WorkflowStatus.FAILED;
        workflow.error = error instanceof Error ? error.message : String(error);
        workflow.updatedAt = new Date();
        this.workflows.set(workflow.id, workflow);

        this.emit("workflow:failed", { 
            workflowId: workflow.id,
            workflow,
            error: workflow.error
        });

        // Initiate rollback if enabled
        if (workflow.definition.rollbackOnError) {
            await this.rollbackWorkflow(workflow);
        }
    }

    /**
     * Rolls back workflow steps in reverse order
     */
    private async rollbackWorkflow(workflow: WorkflowState): Promise<void> {
        const originalStatus = workflow.status;
        workflow.status = WorkflowStatus.ROLLING_BACK;
        this.emit("workflow:rollback:started", { workflowId: workflow.id });

        // Execute rollback handlers in reverse order
        for (let i = workflow.steps.length - 1; i >= 0; i--) {
            const step = workflow.steps[i];
            const originalStep = workflow.definition.steps.find(s => s.id === step.stepId);
            
            if (originalStep?.rollback) {
                try {
                    await originalStep.rollback(workflow.variables);
                    this.emit("workflow:step:rolledback", { 
                        workflowId: workflow.id,
                        stepId: step.stepId
                    });
                } catch (error) {
                    console.error(`Rollback failed for step ${step.stepId}:`, error);
                    this.emit("workflow:rollback:failed", {
                        workflowId: workflow.id,
                        stepId: step.stepId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }

        workflow.status = originalStatus === WorkflowStatus.CANCELLED ? 
            WorkflowStatus.CANCELLED : WorkflowStatus.ROLLED_BACK;
        workflow.updatedAt = new Date();
        this.workflows.set(workflow.id, workflow);
        this.emit("workflow:rollback:completed", { workflowId: workflow.id });
    }

    /**
     * Cleanup resources and stop background tasks
     */
    public async cleanup(): Promise<void> {
        // Stop workflow planner
        clearInterval(this.planningInterval);
        
        // Clean up active workflows
        for (const workflowId of this.activeWorkflows) {
            const workflow = this.workflows.get(workflowId);
            if (workflow && workflow.status === WorkflowStatus.RUNNING) {
                workflow.status = WorkflowStatus.CANCELLED;
                workflow.updatedAt = new Date();
                this.workflows.set(workflowId, workflow);
            }
        }

        // Clear data structures
        this.activeWorkflows.clear();
        this.workflowQueue = [];
        this.executionMetrics.clear();
        this.rollbackHandlers.clear();
    }
}