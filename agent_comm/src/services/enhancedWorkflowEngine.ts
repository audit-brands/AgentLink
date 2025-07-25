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
    WorkflowExecutionOptions,
    WorkflowLifecycleHook
} from '../types/workflow';
import { WorkflowMetricsService } from './workflowMetrics';
import { EnhancedResourceManager, ResourceRequest } from './enhancedResourceManager';
import { TaskScheduler } from './taskScheduler';

interface WorkflowCache {
    state: WorkflowState;
    lastAccessed: number;
    metrics: any;
}

/**
 * Enhanced workflow engine with advanced lifecycle management and performance optimizations
 */
export class EnhancedWorkflowEngine extends EventEmitter {
    private workflows: Map<string, WorkflowCache> = new Map();
    private rollbackHandlers: Map<string, WorkflowRollback> = new Map();
    private lifecycleHooks: Map<string, WorkflowLifecycleHook[]> = new Map();
    private metricsService: WorkflowMetricsService;
    private taskScheduler: TaskScheduler;
    private resourceManager: EnhancedResourceManager;
    private cacheTimeout: number = 30 * 60 * 1000; // 30 minutes
    private maxConcurrentWorkflows: number;
    private activeWorkflows: number = 0;

    constructor(
        resourceManager: EnhancedResourceManager,
        taskScheduler: TaskScheduler,
        options: {
            maxConcurrentWorkflows?: number;
            cacheTimeout?: number;
        } = {}
    ) {
        super();
        this.resourceManager = resourceManager;
        this.metricsService = new WorkflowMetricsService(resourceManager);
        this.taskScheduler = taskScheduler;
        this.maxConcurrentWorkflows = options.maxConcurrentWorkflows || 10;
        this.cacheTimeout = options.cacheTimeout || this.cacheTimeout;
        
        this.setupEventHandlers();
        this.startMaintenanceInterval();
    }

    /**
     * Creates a new workflow instance with enhanced lifecycle management
     */
    public async createWorkflow(
        definition: WorkflowDefinition,
        options: WorkflowExecutionOptions = {}
    ): Promise<string> {
        // Check workflow concurrency limits
        if (this.activeWorkflows >= this.maxConcurrentWorkflows) {
            throw new Error('Maximum concurrent workflows limit reached');
        }

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
            updatedAt: new Date(),
            resourceUsage: {
                memory: 0,
                cpu: 0,
                peakMemory: 0,
                peakCpu: 0
            }
        };

        // Initialize workflow cache
        this.workflows.set(workflowId, {
            state,
            lastAccessed: Date.now(),
            metrics: await this.metricsService.initializeWorkflow(workflowId)
        });

        // Register lifecycle hooks
        if (options.lifecycleHooks) {
            this.lifecycleHooks.set(workflowId, options.lifecycleHooks);
        }

        this.activeWorkflows++;
        await this.executeLifecycleHook(workflowId, 'onCreate');
        this.emit('workflow:created', { workflowId, state });
        
        return workflowId;
    }

    /**
     * Starts workflow execution with resource awareness
     */
    public async startWorkflow(workflowId: string): Promise<void> {
        const cache = this.workflows.get(workflowId);
        if (!cache) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        const { state } = cache;
        cache.lastAccessed = Date.now();

        // Check resource availability
        const resourceRequest = this.estimateWorkflowResources(state.definition);
        const canExecute = await this.resourceManager.canHandleTask(resourceRequest);
        if (!canExecute) {
            throw new Error('Insufficient resources to start workflow');
        }

        state.status = WorkflowStatus.RUNNING;
        state.updatedAt = new Date();
        await this.metricsService.updateMetrics(workflowId, state);
        await this.executeLifecycleHook(workflowId, 'onStart');
        this.emit('workflow:started', { workflowId, state });

        try {
            await this.executeWorkflow(state, resourceRequest);
        } catch (error) {
            await this.handleWorkflowError(state, error);
        }
    }

    /**
     * Estimates total resource requirements for a workflow
     */
    private estimateWorkflowResources(definition: WorkflowDefinition): ResourceRequest {
        let totalMemory = 256 * 1024 * 1024; // Base memory requirement (256MB)
        let maxCpu = 10; // Base CPU requirement (10%)

        // Calculate based on step requirements
        for (const step of definition.steps) {
            if (step.resourceRequirements) {
                totalMemory = Math.max(totalMemory, step.resourceRequirements.memory || 0);
                maxCpu = Math.max(maxCpu, step.resourceRequirements.cpu || 0);
            }
        }

        return {
            memory: totalMemory,
            cpu: maxCpu,
            timeoutMs: definition.timeout || 3600000 // Default 1 hour timeout
        };
    }

    /**
     * Executes workflow with enhanced resource management and monitoring
     */
    private async executeWorkflow(
        workflow: WorkflowState,
        resourceRequest: ResourceRequest
    ): Promise<void> {
        const { definition } = workflow;
        const maxConcurrent = definition.maxConcurrentSteps || 1;
        const runningSteps = new Set<string>();

        // Reserve resources for workflow
        const resourceReserved = await this.resourceManager.reserveResources(
            workflow.id,
            resourceRequest
        );
        if (!resourceReserved) {
            throw new Error('Failed to reserve resources for workflow');
        }

        try {
            while (workflow.currentStep < definition.steps.length && 
                   workflow.status === WorkflowStatus.RUNNING) {
                
                const executableSteps = await this.getExecutableSteps(
                    workflow,
                    maxConcurrent - runningSteps.size
                );

                if (executableSteps.length === 0) {
                    if (runningSteps.size > 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        continue;
                    }
                    break;
                }

                // Execute steps with resource tracking
                const stepPromises = executableSteps.map(step => {
                    runningSteps.add(step.id);
                    return this.executeStep(step, workflow)
                        .then(async (result) => {
                            // Update resource usage metrics
                            const metrics = await this.resourceManager.getEnhancedMetrics();
                            workflow.resourceUsage = {
                                memory: metrics.memory.processUsage,
                                cpu: metrics.cpu.processUsage,
                                peakMemory: Math.max(
                                    workflow.resourceUsage.peakMemory,
                                    metrics.memory.processUsage
                                ),
                                peakCpu: Math.max(
                                    workflow.resourceUsage.peakCpu,
                                    metrics.cpu.processUsage
                                )
                            };
                            return result;
                        })
                        .finally(() => {
                            runningSteps.delete(step.id);
                        });
                });

                try {
                    await Promise.all(stepPromises);
                    workflow.currentStep += executableSteps.length;
                    await this.executeLifecycleHook(workflow.id, 'onStepComplete');
                } catch (error) {
                    await this.executeLifecycleHook(workflow.id, 'onStepError', { error });
                    if (!workflow.definition.continueOnError) {
                        throw error;
                    }
                    console.error('Step execution failed:', error);
                }

                workflow.updatedAt = new Date();
                await this.metricsService.updateMetrics(workflow.id, workflow);
            }

            if (workflow.status === WorkflowStatus.RUNNING) {
                workflow.status = WorkflowStatus.COMPLETED;
                workflow.updatedAt = new Date();
                await this.metricsService.updateMetrics(workflow.id, workflow);
                await this.executeLifecycleHook(workflow.id, 'onComplete');
                this.emit('workflow:completed', { workflowId: workflow.id, workflow });
            }
        } finally {
            // Release reserved resources
            this.resourceManager.releaseResources(workflow.id);
            this.activeWorkflows--;
        }
    }

    /**
     * Executes workflow step with enhanced error handling and monitoring
     */
    private async executeStep(step: WorkflowStep, workflow: WorkflowState): Promise<void> {
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
            attempts: 0,
            metrics: {
                duration: 0,
                memoryUsage: 0,
                cpuUsage: 0
            }
        };

        workflow.steps.push(stepState);
        await this.executeLifecycleHook(workflow.id, 'onStepStart', { step });
        this.emit('workflow:step:started', { workflowId: workflow.id, step });

        const startTime = process.hrtime();
        const startMemory = process.memoryUsage().heapUsed;

        try {
            let result;
            if (step.resourceRequirements) {
                result = await this.executeDistributedStep(step, workflow);
            } else {
                result = await step.execute(workflow.variables);
            }

            const [seconds, nanoseconds] = process.hrtime(startTime);
            stepState.metrics = {
                duration: seconds * 1000 + nanoseconds / 1000000,
                memoryUsage: process.memoryUsage().heapUsed - startMemory,
                cpuUsage: 0 // Will be updated by resource manager
            };

            stepState.status = WorkflowStatus.COMPLETED;
            stepState.result = result;
            stepState.completedAt = new Date();

            if (step.outputVariable) {
                workflow.variables[step.outputVariable] = result;
            }

            this.emit('workflow:step:completed', {
                workflowId: workflow.id,
                step,
                result,
                metrics: stepState.metrics
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
     * Executes lifecycle hooks for workflow events
     */
    private async executeLifecycleHook(
        workflowId: string,
        hookName: string,
        context: any = {}
    ): Promise<void> {
        const hooks = this.lifecycleHooks.get(workflowId);
        if (!hooks) return;

        for (const hook of hooks) {
            if (hook[hookName]) {
                try {
                    await hook[hookName](context);
                } catch (error) {
                    console.error(`Lifecycle hook ${hookName} failed:`, error);
                }
            }
        }
    }

    /**
     * Performs periodic maintenance tasks
     */
    private startMaintenanceInterval(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [workflowId, cache] of this.workflows.entries()) {
                // Clean up old workflows
                if (now - cache.lastAccessed > this.cacheTimeout &&
                    cache.state.status !== WorkflowStatus.RUNNING) {
                    this.workflows.delete(workflowId);
                    this.metricsService.cleanup(workflowId);
                    this.lifecycleHooks.delete(workflowId);
                }
            }
        }, 60000); // Run every minute
    }

    /**
     * Sets up event handlers for resource and task events
     */
    private setupEventHandlers(): void {
        this.resourceManager.on('alert', (alert) => {
            if (alert.level === 'critical') {
                this.handleResourceCritical(alert);
            }
        });

        this.taskScheduler.on('task:completed', (task) => {
            this.emit('task:completed', task);
        });

        this.taskScheduler.on('task:failed', (task) => {
            this.emit('task:failed', task);
        });
    }

    /**
     * Handles critical resource alerts
     */
    private async handleResourceCritical(alert: any): Promise<void> {
        // Pause non-critical workflows
        for (const [workflowId, cache] of this.workflows.entries()) {
            if (cache.state.status === WorkflowStatus.RUNNING &&
                cache.state.priority !== WorkflowPriority.CRITICAL) {
                await this.pauseWorkflow(workflowId);
            }
        }
    }

    // ... (remaining methods from WorkflowEngine remain the same)
}