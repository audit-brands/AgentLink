import { TaskQueue, AgentTask, TaskStatus } from '../types/orchestration';

/**
 * In-memory implementation of TaskQueue for basic orchestration
 * Will be replaced with Redis-based implementation in later phases
 */
export class InMemoryTaskQueue implements TaskQueue {
    private tasks: Map<string, AgentTask> = new Map();
    private queue: string[] = [];

    constructor(private maxSize: number = 1000) {}

    async enqueue(task: AgentTask): Promise<void> {
        if (this.queue.length >= this.maxSize) {
            throw new Error('Task queue is full');
        }
        this.tasks.set(task.id, task);
        this.queue.push(task.id);
    }

    async dequeue(): Promise<AgentTask | null> {
        const taskId = this.queue.shift();
        if (!taskId) return null;

        const task = this.tasks.get(taskId);
        if (!task) return null;

        task.status = TaskStatus.IN_PROGRESS;
        task.updatedAt = new Date();
        this.tasks.set(task.id, task);
        return task;
    }

    async peek(): Promise<AgentTask | null> {
        const taskId = this.queue[0];
        if (!taskId) return null;
        return this.tasks.get(taskId) || null;
    }

    async size(): Promise<number> {
        return this.queue.length;
    }

    async getTask(taskId: string): Promise<AgentTask | null> {
        return this.tasks.get(taskId) || null;
    }

    async updateTask(task: AgentTask): Promise<void> {
        task.updatedAt = new Date();
        this.tasks.set(task.id, task);
    }
}