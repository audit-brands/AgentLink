import { AgentStatus } from '../types/orchestration';
import { v4 as uuidv4 } from 'uuid';
import {
    Orchestrator,
    AgentTask,
    TaskStatus,
    OrchestrationMetrics,
    TaskQueue,
    AgentRegistry,
    TaskRouter
} from '../types/orchestration';

/**
 * Core orchestrator implementation for managing task flow between agents
 */
export class BasicOrchestrator implements Orchestrator {
    private metrics: OrchestrationMetrics = {
        taskCount: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageProcessingTime: 0,
        activeAgents: 0
    };

    private processingTimes: number[] = [];

    constructor(
        private taskQueue: TaskQueue,
        private agentRegistry: AgentRegistry,
        private taskRouter: TaskRouter,
        private config: { retryAttempts: number; retryDelay: number }
    ) {
        this.startTaskProcessor();
        this.startMetricsUpdater();
    }

    async submitTask(taskData: Partial<AgentTask>): Promise<string> {
        const taskId = uuidv4();
        const task: AgentTask = {
            id: taskId,
            method: taskData.method || '',
            params: taskData.params || {},
            sourceAgent: taskData.sourceAgent || 'system',
            targetAgent: taskData.targetAgent || '',
            status: TaskStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Route task if target not specified
        if (!task.targetAgent) {
            try {
                task.targetAgent = await this.taskRouter.route(task);
            } catch (error) {
                throw new Error(`No agent available to handle task: ${error.message}`);
            }
        } else {
            // Verify target agent exists
            const agent = await this.agentRegistry.getAgent(task.targetAgent);
            if (!agent) {
                throw new Error(`Target agent ${task.targetAgent} not found`);
            }
        }

        await this.taskQueue.enqueue(task);
        this.metrics.taskCount++;
        
        return taskId;
    }

    async getTaskStatus(taskId: string): Promise<TaskStatus> {
        const task = await this.taskQueue.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        return task.status;
    }

    async cancelTask(taskId: string): Promise<boolean> {
        const task = await this.taskQueue.getTask(taskId);
        if (!task || task.status !== TaskStatus.PENDING) {
            return false;
        }
        
        task.status = TaskStatus.FAILED;
        task.error = 'Task cancelled';
        await this.taskQueue.updateTask(task);
        this.metrics.failedTasks++;
        return true;
    }

    async getMetrics(): Promise<OrchestrationMetrics> {
        return { ...this.metrics };
    }

    private async startTaskProcessor(): Promise<void> {
        const processQueue = async () => {
            try {
                const task = await this.taskQueue.dequeue();
                if (task) {
                    await this.processTask(task);
                }
            } catch (error) {
                console.error('Error processing task:', error);
            }
        };

        // Initial processing
        await processQueue();

        // Continue processing every 100ms
        setInterval(processQueue, 100);
    }

    private async processTask(task: AgentTask): Promise<void> {
        const startTime = Date.now();
        let attempts = 0;

        while (attempts < this.config.retryAttempts) {
            try {
                const agent = await this.agentRegistry.getAgent(task.targetAgent);
                if (!agent) {
                    throw new Error(`Agent ${task.targetAgent} not found`);
                }

                // TODO: Implement actual agent communication
                // For now, just simulate processing
                await new Promise(resolve => setTimeout(resolve, 1000));

                task.status = TaskStatus.COMPLETED;
                task.updatedAt = new Date();
                await this.taskQueue.updateTask(task);
                this.metrics.completedTasks++;

                const processingTime = Date.now() - startTime;
                this.processingTimes.push(processingTime);
                
                return;
            } catch (error) {
                attempts++;
                if (attempts >= this.config.retryAttempts) {
                    task.status = TaskStatus.FAILED;
                    task.error = error instanceof Error ? error.message : 'Unknown error';
                    task.updatedAt = new Date();
                    await this.taskQueue.updateTask(task);
                    this.metrics.failedTasks++;
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
            }
        }
    }

    private async startMetricsUpdater(): Promise<void> {
        const updateMetrics = async () => {
            const agents = await this.agentRegistry.listAgents();
            this.metrics.activeAgents = agents.filter(a => a.status === AgentStatus.ONLINE).length;
            
            if (this.processingTimes.length > 0) {
                const total = this.processingTimes.reduce((a, b) => a + b, 0);
                this.metrics.averageProcessingTime = total / this.processingTimes.length;
            }
        };

        // Initial update
        await updateMetrics();

        // Update every 5 seconds
        setInterval(updateMetrics, 5000);
    }
}