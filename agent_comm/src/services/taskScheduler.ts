import { EventEmitter } from 'events';
import { EnhancedResourceManager } from './enhancedResourceManager';

export interface Task {
    id: string;
    execute: () => Promise<any>;
    onSuccess?: (result: any) => void;
    onError?: (error: Error) => void;
    requiredResources: {
        memory: number;
        cpu: number;
    };
    retryCount?: number;
    timeout?: number;
}

export interface TaskSchedulerConfig {
    maxConcurrentTasks: number;
    taskTimeoutMs: number;
    maxRetries: number;
}

export class TaskScheduler extends EventEmitter {
    private tasks: Map<string, Task>;
    private activeTasks: Set<string>;
    private resourceManager: EnhancedResourceManager;
    private config: TaskSchedulerConfig;
    private eventEmitter: EventEmitter;

    constructor(
        config: TaskSchedulerConfig,
        resourceManager: EnhancedResourceManager,
        eventEmitter: EventEmitter
    ) {
        super();
        this.config = config;
        this.resourceManager = resourceManager;
        this.eventEmitter = eventEmitter;
        this.tasks = new Map();
        this.activeTasks = new Set();
    }

    public async canExecuteTask(task: Task): Promise<boolean> {
        if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
            return false;
        }

        // Check if task already exists
        if (this.tasks.has(task.id)) {
            return false;
        }

        // Check resource availability through resource manager
        try {
            return await this.resourceManager.canHandleTask(task.requiredResources);
        } catch (error) {
            this.emit('task:resource:check:failed', { taskId: task.id, error });
            return false;
        }
    }

    public addTask(task: Task): string {
        this.tasks.set(task.id, task);
        return task.id;
    }

    public async executeTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        if (this.activeTasks.has(taskId)) {
            throw new Error(`Task ${taskId} is already running`);
        }

        if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
            throw new Error(`Maximum concurrent tasks limit reached`);
        }

        this.activeTasks.add(taskId);
        
        try {
            // Reserve resources
            const resourcesReserved = await this.resourceManager.reserveResources(taskId, task.requiredResources);
            if (!resourcesReserved) {
                throw new Error(`Failed to reserve resources for task ${taskId}`);
            }
            
            // Execute task with timeout
            const result = await Promise.race([
                task.execute(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Task timeout')), 
                    task.timeout || this.config.taskTimeoutMs)
                )
            ]);

            task.onSuccess?.(result);
            this.emit('task:completed', { taskId, result });
        } catch (error) {
            task.onError?.(error as Error);
            this.emit('task:failed', { taskId, error });
            throw error;
        } finally {
            // Release resources
            await this.resourceManager.releaseResources(taskId);
            this.activeTasks.delete(taskId);
        }
    }

    public async cancelTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        if (this.activeTasks.has(taskId)) {
            await this.resourceManager.releaseResources(taskId);
            this.activeTasks.delete(taskId);
        }

        this.tasks.delete(taskId);
        this.emit('task:cancelled', task);
    }

    public getActiveTaskCount(): number {
        return this.activeTasks.size;
    }

    public isTaskActive(taskId: string): boolean {
        return this.activeTasks.has(taskId);
    }

    public cleanup(): void {
        this.tasks.clear();
        this.activeTasks.clear();
        this.removeAllListeners();
    }
}