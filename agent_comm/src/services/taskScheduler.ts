import { EventEmitter } from 'events';
import { EnhancedResourceManager } from './enhancedResourceManager';
import { AgentCommunicationService } from './agentCommunication';

export interface WorkflowTask {
    id: string;
    agentId: string;
    priority: number;
    estimatedMemory: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    dependencies?: string[];
    retryCount: number;
    maxRetries: number;
    created: Date;
    started?: Date;
    completed?: Date;
    error?: Error;
    distributionPreference?: 'local' | 'remote' | 'any';
    resourceRequirements: {
        memory: number;
        cpu: number;
        timeoutMs?: number;
    };
}

export interface TaskSchedulerConfig {
    maxConcurrentTasks: number;
    defaultMaxRetries: number;
    retryDelayMs: number;
    taskTimeoutMs: number;
    resourceReservationTimeout?: number;
}

export class TaskScheduler extends EventEmitter {
    private tasks: Map<string, WorkflowTask>;
    private runningTasks: Set<string>;
    private readonly config: TaskSchedulerConfig;
    private readonly resourceManager: EnhancedResourceManager;
    private readonly agentCommunication: AgentCommunicationService;
    private schedulerInterval: NodeJS.Timer;
    private isProcessing: boolean;

    constructor(
        config: TaskSchedulerConfig,
        resourceManager: EnhancedResourceManager,
        agentCommunication: AgentCommunicationService
    ) {
        super();
        this.config = config;
        this.resourceManager = resourceManager;
        this.agentCommunication = agentCommunication;
        this.tasks = new Map();
        this.runningTasks = new Set();
        this.isProcessing = false;

        // Start the scheduler
        this.schedulerInterval = setInterval(() => {
            if (!this.isProcessing) {
                this.scheduleNext().catch(console.error);
            }
        }, 100);

        // Listen for resource alerts
        this.resourceManager.on('alert', (alert) => {
            if (alert.level === 'critical') {
                this.handleResourceCritical(alert.type);
            }
        });

        // Listen for agent communication events
        this.setupAgentListeners();
    }

    /**
     * Add a new task to the scheduler
     */
    public addTask(task: Omit<WorkflowTask, 'status' | 'retryCount' | 'created'>): string {
        const newTask: WorkflowTask = {
            ...task,
            status: 'pending',
            retryCount: 0,
            created: new Date(),
            resourceRequirements: {
                ...task.resourceRequirements,
                timeoutMs: task.resourceRequirements.timeoutMs || this.config.resourceReservationTimeout
            }
        };

        this.tasks.set(newTask.id, newTask);
        this.emit('task:added', newTask);
        return newTask.id;
    }

    /**
     * Get the current status of a task
     */
    public getTaskStatus(taskId: string): WorkflowTask | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * Cancel a pending or running task
     */
    public async cancelTask(taskId: string): Promise<boolean> {
        const task = this.tasks.get(taskId);
        if (!task || task.status === 'completed') {
            return false;
        }

        if (task.status === 'running') {
            this.runningTasks.delete(taskId);
            // Release reserved resources
            this.resourceManager.releaseResources(taskId);
            
            // If task is running on a remote agent, notify it
            if (task.agentId !== 'local') {
                await this.agentCommunication.sendMessage({
                    id: `cancel_${taskId}`,
                    type: 'request',
                    source: 'scheduler',
                    target: task.agentId,
                    payload: {
                        action: 'cancel',
                        taskId
                    },
                    timestamp: new Date()
                });
            }
        }

        task.status = 'failed';
        task.error = new Error('Task cancelled');
        task.completed = new Date();
        this.emit('task:cancelled', task);
        return true;
    }

    /**
     * Stop the scheduler
     */
    public stop(): void {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
        }
    }

    private async scheduleNext(): Promise<void> {
        if (this.isProcessing || this.runningTasks.size >= this.config.maxConcurrentTasks) {
            return;
        }

        this.isProcessing = true;

        try {
            const eligibleTasks = Array.from(this.tasks.values())
                .filter(task => this.isTaskEligible(task))
                .sort((a, b) => b.priority - a.priority);

            for (const task of eligibleTasks) {
                if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
                    break;
                }

                const executionStrategy = await this.determineExecutionStrategy(task);
                if (executionStrategy) {
                    await this.executeTask(task, executionStrategy);
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private isTaskEligible(task: WorkflowTask): boolean {
        if (task.status !== 'pending') {
            return false;
        }

        // Check dependencies
        if (task.dependencies?.length) {
            return task.dependencies.every(depId => {
                const dep = this.tasks.get(depId);
                return dep?.status === 'completed';
            });
        }

        return true;
    }

    private async determineExecutionStrategy(task: WorkflowTask): Promise<'local' | 'remote' | undefined> {
        // Check if task can be executed locally
        const localExecution = await this.resourceManager.canHandleTask({
            memory: task.resourceRequirements.memory,
            cpu: task.resourceRequirements.cpu,
            timeoutMs: task.resourceRequirements.timeoutMs
        });

        if (task.distributionPreference === 'local' && localExecution) {
            return 'local';
        }

        // Check for remote execution if allowed
        if (task.distributionPreference !== 'local') {
            const availableAgent = this.agentCommunication.findBestNodeForTask(task);
            if (availableAgent) {
                return 'remote';
            }
        }

        // If no preference and local execution is possible, use local
        if (task.distributionPreference === 'any' && localExecution) {
            return 'local';
        }

        return undefined;
    }

    private async executeTask(task: WorkflowTask, strategy: 'local' | 'remote'): Promise<void> {
        // Reserve resources before execution
        const resourceReserved = await this.resourceManager.reserveResources(
            task.id,
            {
                memory: task.resourceRequirements.memory,
                cpu: task.resourceRequirements.cpu,
                timeoutMs: task.resourceRequirements.timeoutMs
            }
        );

        if (!resourceReserved) {
            return;
        }

        task.status = 'running';
        task.started = new Date();
        this.runningTasks.add(task.id);

        try {
            if (strategy === 'local') {
                await this.executeLocalTask(task);
            } else {
                await this.executeRemoteTask(task);
            }
        } catch (error) {
            await this.handleTaskError(task, error as Error);
        }
    }

    private async executeLocalTask(task: WorkflowTask): Promise<void> {
        this.emit('task:started', { ...task, executionType: 'local' });

        try {
            // Set timeout for task execution
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Task timeout')), this.config.taskTimeoutMs);
            });

            // Execute task (placeholder for actual execution)
            const executionPromise = new Promise(resolve => setTimeout(resolve, 500));

            await Promise.race([executionPromise, timeoutPromise]);
            
            task.status = 'completed';
            task.completed = new Date();
            this.runningTasks.delete(task.id);
            this.resourceManager.releaseResources(task.id);
            this.emit('task:completed', task);
        } catch (error) {
            throw error;
        }
    }

    private async executeRemoteTask(task: WorkflowTask): Promise<void> {
        const targetAgent = this.agentCommunication.findBestNodeForTask(task);
        if (!targetAgent) {
            throw new Error('No suitable agent found for remote execution');
        }

        task.agentId = targetAgent.id;
        this.emit('task:started', { ...task, executionType: 'remote' });

        const success = await this.agentCommunication.assignTask(task, targetAgent.id);
        if (!success) {
            throw new Error('Failed to assign task to remote agent');
        }
    }

    private async handleTaskError(task: WorkflowTask, error: Error): Promise<void> {
        task.error = error;
        this.runningTasks.delete(task.id);
        this.resourceManager.releaseResources(task.id);

        if (task.retryCount < (task.maxRetries ?? this.config.defaultMaxRetries)) {
            task.retryCount++;
            task.status = 'pending';
            this.emit('task:retry', task);
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
        } else {
            task.status = 'failed';
            task.completed = new Date();
            this.emit('task:failed', task);
        }
    }

    private handleResourceCritical(resourceType: string): void {
        // Cancel tasks and release resources
        for (const taskId of this.runningTasks) {
            const task = this.tasks.get(taskId);
            if (task && task.status === 'running') {
                this.cancelTask(taskId).catch(console.error);
            }
        }
    }

    private setupAgentListeners(): void {
        this.agentCommunication.on('task:status:updated', (message) => {
            const task = this.tasks.get(message.taskId);
            if (task) {
                if (message.payload.status === 'completed') {
                    task.status = 'completed';
                    task.completed = new Date();
                    this.runningTasks.delete(task.id);
                    this.resourceManager.releaseResources(task.id);
                    this.emit('task:completed', task);
                } else if (message.payload.status === 'failed') {
                    this.handleTaskError(task, new Error(message.payload.error)).catch(console.error);
                }
            }
        });
    }
}