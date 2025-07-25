import { AgentStatus } from '../types/orchestration';
import { v4 as uuidv4 } from 'uuid';
import {
    Orchestrator,
    AgentTask,
    TaskStatus,
    OrchestrationMetrics,
    TaskQueue,
    AgentRegistry,
    TaskRouter,
    RegisteredAgent
} from '../types/orchestration';

interface TaskExecutionContext {
    retryCount: number;
    lastError?: Error;
    startTime: number;
    dependencies?: string[];
}

/**
 * Enhanced orchestrator implementation with dynamic routing and parallel execution
 */
export class EnhancedOrchestrator implements Orchestrator {
    private metrics: OrchestrationMetrics = {
        taskCount: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageProcessingTime: 0,
        activeAgents: 0
    };

    private processingTimes: number[] = [];
    private taskContexts: Map<string, TaskExecutionContext> = new Map();
    private maxConcurrentTasks: number;
    private activeTaskCount: number = 0;

    constructor(
        private taskQueue: TaskQueue,
        private agentRegistry: AgentRegistry,
        private taskRouter: TaskRouter,
        private config: { 
            retryAttempts: number;
            retryDelay: number;
            maxConcurrentTasks?: number;
        }
    ) {
        this.maxConcurrentTasks = config.maxConcurrentTasks || 10;
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

        // Initialize task context
        this.taskContexts.set(taskId, {
            retryCount: 0,
            startTime: Date.now(),
            dependencies: taskData.params?.dependencies as string[]
        });

        // Route task if target not specified
        if (!task.targetAgent) {
            try {
                // Enhanced routing with capability matching
                const agents = await this.agentRegistry.listAgents();
                const availableAgents = agents.filter(agent => 
                    agent.status === AgentStatus.ONLINE &&
                    agent.capabilities.some(cap => 
                        cap.methods.includes(task.method)
                    )
                );

                if (availableAgents.length === 0) {
                    throw new Error(`No agent available with capability: ${task.method}`);
                }

                // Simple load balancing - choose agent with fewest active tasks
                task.targetAgent = await this.taskRouter.route(task);
            } catch (error) {
                throw new Error(`Task routing failed: ${error.message}`);
            }
        } else {
            // Verify target agent exists and has capability
            const agent = await this.agentRegistry.getAgent(task.targetAgent);
            if (!agent) {
                throw new Error(`Target agent ${task.targetAgent} not found`);
            }
            if (!this.agentHasCapability(agent, task.method)) {
                throw new Error(`Agent ${task.targetAgent} cannot handle method: ${task.method}`);
            }
        }

        await this.taskQueue.enqueue(task);
        this.metrics.taskCount++;
        
        return taskId;
    }

    private agentHasCapability(agent: RegisteredAgent, method: string): boolean {
        return agent.capabilities.some(cap => cap.methods.includes(method));
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
        task.error = 'Task cancelled by user';
        await this.taskQueue.updateTask(task);
        this.metrics.failedTasks++;
        
        // Clean up task context
        this.taskContexts.delete(taskId);
        return true;
    }

    async getMetrics(): Promise<OrchestrationMetrics> {
        return { ...this.metrics };
    }

    private async startTaskProcessor(): Promise<void> {
        const processQueue = async () => {
            try {
                // Check if we can process more tasks
                if (this.activeTaskCount >= this.maxConcurrentTasks) {
                    return;
                }

                const task = await this.taskQueue.dequeue();
                if (task) {
                    // Check dependencies before processing
                    const context = this.taskContexts.get(task.id);
                    if (context?.dependencies?.length) {
                        const unfinishedDeps = await this.checkDependencies(context.dependencies);
                        if (unfinishedDeps.length > 0) {
                            // Re-queue task if dependencies aren't met
                            await this.taskQueue.enqueue(task);
                            return;
                        }
                    }

                    // Process task in parallel
                    this.activeTaskCount++;
                    this.processTask(task).finally(() => {
                        this.activeTaskCount--;
                    });
                }
            } catch (error) {
                console.error('Error processing task:', error);
            }
        };

        // Process queue frequently
        setInterval(processQueue, 100);
    }

    private async checkDependencies(dependencies: string[]): Promise<string[]> {
        const unfinished: string[] = [];
        for (const depId of dependencies) {
            const status = await this.getTaskStatus(depId).catch(() => TaskStatus.FAILED);
            if (status !== TaskStatus.COMPLETED) {
                unfinished.push(depId);
            }
        }
        return unfinished;
    }

    private async processTask(task: AgentTask): Promise<void> {
        const context = this.taskContexts.get(task.id);
        if (!context) {
            throw new Error(`No context found for task ${task.id}`);
        }

        while (context.retryCount < this.config.retryAttempts) {
            try {
                const agent = await this.agentRegistry.getAgent(task.targetAgent);
                if (!agent) {
                    throw new Error(`Agent ${task.targetAgent} not found`);
                }

                if (agent.status !== AgentStatus.ONLINE) {
                    throw new Error(`Agent ${task.targetAgent} is not online`);
                }

                // Execute task via JSON-RPC
                const response = await fetch(agent.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: task.method,
                        params: task.params,
                        id: task.id
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                if (result.error) {
                    throw new Error(result.error.message || 'Unknown error from agent');
                }

                task.status = TaskStatus.COMPLETED;
                task.result = result.result;
                task.updatedAt = new Date();
                await this.taskQueue.updateTask(task);
                this.metrics.completedTasks++;

                const processingTime = Date.now() - context.startTime;
                this.processingTimes.push(processingTime);
                
                // Clean up task context
                this.taskContexts.delete(task.id);
                return;

            } catch (error) {
                context.retryCount++;
                context.lastError = error as Error;

                if (context.retryCount >= this.config.retryAttempts) {
                    task.status = TaskStatus.FAILED;
                    task.error = error instanceof Error ? error.message : 'Unknown error';
                    task.updatedAt = new Date();
                    await this.taskQueue.updateTask(task);
                    this.metrics.failedTasks++;
                    
                    // Clean up task context
                    this.taskContexts.delete(task.id);
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

        // Update metrics every 5 seconds
        setInterval(updateMetrics, 5000);
    }
}