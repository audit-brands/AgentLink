import { EventEmitter } from 'events';
import { Task } from './enhancedOrchestrator';

export class ResourceAwareTaskRouter extends EventEmitter {
    private tasks: Map<string, Task>;

    constructor() {
        super();
        this.tasks = new Map();
    }

    public async routeTask(task: Task, agentId: string): Promise<void> {
        this.tasks.set(task.id, {
            ...task,
            targetAgent: agentId
        });
        this.emit('task:assigned', task.id, agentId);
    }

    public async completeTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'completed';
            this.tasks.set(taskId, task);
            this.emit('task:completed', taskId);
        }
    }

    public async failTask(taskId: string, error: Error): Promise<void> {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'failed';
            this.tasks.set(taskId, task);
            this.emit('task:failed', taskId, error);
        }
    }

    public getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    public getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    public getRunningTasks(): Task[] {
        return Array.from(this.tasks.values())
            .filter(task => task.status === 'running');
    }

    public getTasksByAgent(agentId: string): Task[] {
        return Array.from(this.tasks.values())
            .filter(task => task.targetAgent === agentId);
    }

    public clearAgentTasks(agentId: string): void {
        const agentTasks = this.getTasksByAgent(agentId);
        agentTasks.forEach(task => {
            this.failTask(task.id, new Error('Agent disconnected'));
        });
    }
}