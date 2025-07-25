import { EventEmitter } from 'events';
import { ResourceManager } from './resourceManager';

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
}

export interface TaskSchedulerConfig {
    maxConcurrentTasks: number;
    defaultMaxRetries: number;
    retryDelayMs: number;
    taskTimeoutMs: number;
}

export class TaskScheduler extends EventEmitter {
    private tasks: Map<string, WorkflowTask>;
    private runningTasks: Set<string>;
    private readonly config: TaskSchedulerConfig;
    private readonly resourceManager: ResourceManager;
    private schedulerInterval: NodeJS.Timer;
    private isProcessing: boolean;

    constructor(config: TaskSchedulerConfig, resourceManager: ResourceManager) {
        super();
        this.config = config;
        this.resourceManager = resourceManager;
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
    }

    /**
     * Add a new task to the scheduler
     */
    public addTask(task: Omit<WorkflowTask, 'status' | 'retryCount' | 'created'>): string {
        const newTask: WorkflowTask = {
            ...task,
            status: 'pending',
            retryCount: 0,
            created: new Date()
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
    public cancelTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || task.status === 'completed') {
            return false;
        }

        if (task.status === 'running') {
            this.runningTasks.delete(taskId);
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

                if (await this.canRunTask(task)) {
                    await this.startTask(task);
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

    private async canRunTask(task: WorkflowTask): Promise<boolean> {
        // Check resource availability
        if (!this.resourceManager.canAllocateMemory(task.estimatedMemory)) {
            return false;
        }

        return true;
    }

    private async startTask(task: WorkflowTask): Promise<void> {
        task.status = 'running';
        task.started = new Date();
        this.runningTasks.add(task.id);
        this.emit('task:started', task);

        try {
            // Set timeout for task execution
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Task timeout')), this.config.taskTimeoutMs);
            });

            // Execute task (this will be replaced with actual agent execution)
            const executionPromise = this.executeTask(task);

            await Promise.race([executionPromise, timeoutPromise]);
            
            if (task.status === 'running') {
                task.status = 'completed';
                task.completed = new Date();
                this.runningTasks.delete(task.id);
                this.emit('task:completed', task);
            }
        } catch (error) {
            if (task.status === 'running') {
                await this.handleTaskError(task, error as Error);
            }
        }
    }

    private async executeTask(task: WorkflowTask): Promise<void> {
        // This is a placeholder for actual agent execution
        // Will be implemented with agent communication
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Simulate failures for testing
        if (task.id.includes('failing')) {
            throw new Error('Task execution failed');
        }
        
        // Simulate timeouts for testing
        if (task.id.includes('timeout')) {
            await new Promise(resolve => setTimeout(resolve, this.config.taskTimeoutMs + 1000));
        }
    }

    private async handleTaskError(task: WorkflowTask, error: Error): Promise<void> {
        task.error = error;
        this.runningTasks.delete(task.id);

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
        // Pause new task scheduling and cancel running tasks
        if (resourceType === 'memory') {
            // Cancel all running tasks
            for (const taskId of this.runningTasks) {
                const task = this.tasks.get(taskId);
                if (task && task.status === 'running') {
                    task.status = 'failed';
                    task.error = new Error('Resource critical: task cancelled');
                    task.completed = new Date();
                    this.emit('task:cancelled', task);
                }
            }
            
            // Reset running tasks set
            this.runningTasks.clear();
        }
    }
}