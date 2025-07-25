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
import { EnhancedResourceManager, ResourceRequest } from './enhancedResourceManager';

interface TaskExecutionContext {
    retryCount: number;
    lastError?: Error;
    startTime: number;
    dependencies?: string[];
    resourceRequest?: ResourceRequest;
}

/**
 * Resource-aware workflow orchestrator implementation with dynamic routing and parallel execution
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
    private isProcessing: boolean = false;
    private taskProcessorInterval?: NodeJS.Timeout;
    private metricsUpdaterInterval?: NodeJS.Timeout;

    constructor(
        private taskQueue: TaskQueue,
        private agentRegistry: AgentRegistry,
        private taskRouter: TaskRouter,
        private resourceManager: EnhancedResourceManager,
        private config: { 
            retryAttempts: number;
            retryDelay: number;
            maxConcurrentTasks?: number;
        }
    ) {
        this.maxConcurrentTasks = config.maxConcurrentTasks || 10;
        this.startTaskProcessor();
        this.startMetricsUpdater();

        // Subscribe to resource alerts
        this.resourceManager.on('alert', (alert) => {
            console.warn(`Resource alert: ${alert.type} ${alert.level} - ${alert.message}`);
            if (alert.level === 'critical') {
                this.handleResourceCritical(alert);
            }
        });
    }

    public cleanup(): void {
        if (this.taskProcessorInterval) {
            clearInterval(this.taskProcessorInterval);
        }
        if (this.metricsUpdaterInterval) {
            clearInterval(this.metricsUpdaterInterval);
        }
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

        // Estimate resource requirements based on task type
        const resourceRequest = this.estimateResourceRequirements(task);
        
        // Initialize task context with resource request
        this.taskContexts.set(taskId, {
            retryCount: 0,
            startTime: Date.now(),
            dependencies: taskData.params?.dependencies as string[],
            resourceRequest
        });

        // Check resource availability before routing
        const canHandle = await this.resourceManager.canHandleTask(resourceRequest);
        if (!canHandle) {
            throw new Error('Insufficient resources to handle task');
        }

        // Route task if target not specified
        if (!task.targetAgent) {
            try {
                const agents = await this.agentRegistry.listAgents();
                const availableAgents = agents.filter(agent => 
                    agent.status === AgentStatus.ONLINE &&
                    agent.capabilities.some(cap => 
                        cap.methods.includes(task.method)
                    )
                ).sort((a, b) => {
                    // Prefer agents with more available resources
                    const aMetrics = this.resourceManager.getResourceUtilization();
                    const bMetrics = this.resourceManager.getResourceUtilization();
                    return (aMetrics.cpu + aMetrics.memory) - (bMetrics.cpu + bMetrics.memory);
                });

                if (availableAgents.length === 0) {
                    throw new Error(`No agent available with capability: ${task.method}`);
                }

                task.targetAgent = availableAgents[0].id;
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

    private estimateResourceRequirements(task: AgentTask): ResourceRequest {
        // Default resource requirements
        const baseRequest: ResourceRequest = {
            memory: 256 * 1024 * 1024, // 256MB
            cpu: 10, // 10% CPU
            timeoutMs: 30000 // 30 seconds
        };

        // Adjust based on task type and parameters
        switch (task.method) {
            case 'processLargeData':
            case 'imageProcessing':
                return {
                    memory: 512 * 1024 * 1024, // 512MB
                    cpu: 25, // 25% CPU
                    timeoutMs: 60000 // 60 seconds
                };
            case 'videoProcessing':
                return {
                    memory: 1024 * 1024 * 1024, // 1GB
                    cpu: 50, // 50% CPU
                    timeoutMs: 300000 // 5 minutes
                };
            default:
                return baseRequest;
        }
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
        
        // Release reserved resources
        const context = this.taskContexts.get(taskId);
        if (context?.resourceRequest) {
            this.resourceManager.releaseResources(taskId);
        }
        
        // Clean up task context
        this.taskContexts.delete(taskId);
        return true;
    }

    async getMetrics(): Promise<OrchestrationMetrics> {
        const resourceMetrics = await this.resourceManager.getEnhancedMetrics();
        return { 
            ...this.metrics,
            resourceUtilization: {
                memory: resourceMetrics.utilizationPercentages.memory,
                cpu: resourceMetrics.utilizationPercentages.cpu
            }
        };
    }

    private handleResourceCritical(alert: any): void {
        // Implement resource-critical handling strategy
        if (alert.type === 'memory' || alert.type === 'cpu') {
            // Pause task processing temporarily
            this.isProcessing = false;
            
            // Wait for resources to free up
            setTimeout(() => {
                this.isProcessing = true;
            }, this.config.retryDelay * 2);
        }
    }

    private async startTaskProcessor(): Promise<void> {
        const processQueue = async () => {
            if (this.isProcessing) return;
            this.isProcessing = true;

            try {
                // Check if we can process more tasks
                if (this.activeTaskCount >= this.maxConcurrentTasks) {
                    return;
                }

                const task = await this.taskQueue.dequeue();
                if (task) {
                    const context = this.taskContexts.get(task.id);
                    
                    // Check dependencies before processing
                    if (context?.dependencies?.length) {
                        const unfinishedDeps = await this.checkDependencies(context.dependencies);
                        if (unfinishedDeps.length > 0) {
                            await this.taskQueue.enqueue(task);
                            return;
                        }
                    }

                    // Reserve resources before processing
                    if (context?.resourceRequest) {
                        const reserved = await this.resourceManager.reserveResources(
                            task.id,
                            context.resourceRequest
                        );
                        if (!reserved) {
                            await this.taskQueue.enqueue(task);
                            return;
                        }
                    }

                    // Process task in parallel
                    this.activeTaskCount++;
                    await this.processTask(task).finally(() => {
                        this.activeTaskCount--;
                        // Release resources after task completion
                        if (context?.resourceRequest) {
                            this.resourceManager.releaseResources(task.id);
                        }
                    });
                }
            } catch (error) {
                console.error('Error processing task:', error);
            } finally {
                this.isProcessing = false;
            }
        };

        // Process queue frequently
        this.taskProcessorInterval = setInterval(processQueue, 100);
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

    protected async processTask(task: AgentTask): Promise<void> {
        let context = this.taskContexts.get(task.id);
        
        // Create context if it doesn't exist (for backward compatibility)
        if (!context) {
            context = {
                retryCount: 0,
                startTime: Date.now(),
                resourceRequest: this.estimateResourceRequirements(task)
            };
            this.taskContexts.set(task.id, context);
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

                // Execute task via JSON-RPC with timeout
                const timeout = context.resourceRequest?.timeoutMs || 30000;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(agent.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: task.method,
                        params: task.params,
                        id: task.id
                    }),
                    signal: controller.signal
                }).finally(() => clearTimeout(timeoutId));

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const jsonRpcResult = await response.json();
                if (jsonRpcResult.error) {
                    task.status = TaskStatus.FAILED;
                    task.error = jsonRpcResult.error.message || 'Unknown error from agent';
                    task.updatedAt = new Date();
                    await this.taskQueue.updateTask(task);
                    this.metrics.failedTasks++;
                    this.taskContexts.delete(task.id);
                    return;
                }

                task.status = TaskStatus.COMPLETED;
                task.result = jsonRpcResult.result;
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

    private startMetricsUpdater(): void {
        const updateMetrics = async () => {
            const agents = await this.agentRegistry.listAgents();
            this.metrics.activeAgents = agents.filter(a => a.status === AgentStatus.ONLINE).length;
            
            if (this.processingTimes.length > 0) {
                const total = this.processingTimes.reduce((a, b) => a + b, 0);
                this.metrics.averageProcessingTime = total / this.processingTimes.length;
            }

            // Update resource utilization metrics
            const resourceMetrics = await this.resourceManager.getEnhancedMetrics();
            this.metrics.resourceUtilization = {
                memory: resourceMetrics.utilizationPercentages.memory,
                cpu: resourceMetrics.utilizationPercentages.cpu
            };
        };

        // Update metrics every 5 seconds
        this.metricsUpdaterInterval = setInterval(updateMetrics, 5000);
    }
}

// Export BasicOrchestrator for backward compatibility
export class BasicOrchestrator extends EnhancedOrchestrator {
    constructor(
        taskQueue: TaskQueue,
        agentRegistry: AgentRegistry,
        taskRouter: TaskRouter,
        resourceManager: EnhancedResourceManager,
        config: { retryAttempts: number; retryDelay: number }
    ) {
        super(taskQueue, agentRegistry, taskRouter, resourceManager, {
            ...config,
            maxConcurrentTasks: 1 // Basic orchestrator runs tasks sequentially
        });
    }
}