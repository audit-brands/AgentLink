import { EnhancedResourceManager } from './enhancedResourceManager';
import { ResourceAwareTaskRouter } from './resourceAwareTaskRouter';
import EventEmitter from 'events';

export interface Task {
    id: string;
    type: string;
    priority: number;
    resourceRequirements: {
        memory: number;
        cpu: number;
    };
    status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
    targetAgent?: string;
}

export interface Agent {
    id: string;
    capabilities: string[];
    status: 'available' | 'busy' | 'offline';
    currentLoad: {
        memory: number;
        cpu: number;
    };
}

export class EnhancedOrchestrator extends EventEmitter {
    private resourceManager: EnhancedResourceManager;
    private taskRouter: ResourceAwareTaskRouter;
    private tasks: Map<string, Task>;
    private agents: Map<string, Agent>;

    constructor(
        resourceManager: EnhancedResourceManager,
        taskRouter: ResourceAwareTaskRouter
    ) {
        super();
        this.resourceManager = resourceManager;
        this.taskRouter = taskRouter;
        this.tasks = new Map();
        this.agents = new Map();

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.taskRouter.on('task:assigned', (taskId: string, agentId: string) => {
            this.handleTaskAssignment(taskId, agentId);
        });

        this.taskRouter.on('task:completed', (taskId: string) => {
            this.handleTaskCompletion(taskId);
        });

        this.taskRouter.on('task:failed', (taskId: string, error: Error) => {
            this.handleTaskFailure(taskId, error);
        });
    }

    public async submitTask(task: Omit<Task, 'status'>): Promise<string> {
        const fullTask: Task = {
            ...task,
            status: 'pending'
        };

        // Check if we have enough resources
        const canHandle = await this.resourceManager.canHandleTask(task.resourceRequirements);
        if (!canHandle) {
            throw new Error('Insufficient resources to handle task');
        }

        this.tasks.set(task.id, fullTask);
        this.updateTaskStatus(task.id, 'pending');
        this.emit('task:submitted', task.id);

        // Attempt to route the task
        await this.routeTask(task.id);

        return task.id;
    }

    public registerAgent(agent: Agent): void {
        this.agents.set(agent.id, {
            ...agent,
            status: 'available',
            currentLoad: {
                memory: 0,
                cpu: 0
            }
        });
        this.emit('agent:registered', agent.id);
    }

    public deregisterAgent(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            // Clear tasks assigned to this agent
            this.taskRouter.clearAgentTasks(agentId);
            
            // Remove agent from registry
            this.agents.delete(agentId);
            this.emit('agent:deregistered', agentId);

            // Try to redistribute any pending tasks
            Array.from(this.tasks.values())
                .filter(task => task.status === 'pending')
                .forEach(task => this.routeTask(task.id));
        }
    }

    private async routeTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        // Get current resource metrics
        const metrics = await this.resourceManager.getEnhancedMetrics();

        // Find available agents that can handle the task
        const availableAgents = Array.from(this.agents.values())
            .filter(agent => 
                agent.status === 'available' &&
                agent.currentLoad.memory + task.resourceRequirements.memory <= metrics.availableResources.memory &&
                agent.currentLoad.cpu + task.resourceRequirements.cpu <= metrics.availableResources.cpu
            );

        if (availableAgents.length === 0) {
            this.emit('task:queued', taskId);
            return;
        }

        // Route task to the most suitable agent
        const selectedAgent = this.selectBestAgent(availableAgents, task);
        if (selectedAgent) {
            // Update task with target agent
            task.targetAgent = selectedAgent.id;
            this.tasks.set(taskId, task);

            // Update agent status and load
            selectedAgent.status = 'busy';
            selectedAgent.currentLoad = {
                memory: selectedAgent.currentLoad.memory + task.resourceRequirements.memory,
                cpu: selectedAgent.currentLoad.cpu + task.resourceRequirements.cpu
            };
            this.agents.set(selectedAgent.id, selectedAgent);

            await this.taskRouter.routeTask(task, selectedAgent.id);
            this.updateTaskStatus(taskId, 'assigned');
        }
    }

    private selectBestAgent(agents: Agent[], task: Task): Agent | null {
        return agents.reduce((best, current) => {
            if (!best) return current;

            // Consider both current load and task requirements
            const bestScore = this.calculateAgentScore(best, task);
            const currentScore = this.calculateAgentScore(current, task);

            return currentScore > bestScore ? current : best;
        }, null as Agent | null);
    }

    private calculateAgentScore(agent: Agent, task: Task): number {
        // Lower scores are better
        const memoryScore = agent.currentLoad.memory / task.resourceRequirements.memory;
        const cpuScore = agent.currentLoad.cpu / task.resourceRequirements.cpu;

        // Weighted average (can be adjusted based on importance)
        return (memoryScore + cpuScore) / 2;
    }

    private updateTaskStatus(taskId: string, status: Task['status']): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = status;
            this.tasks.set(taskId, task);
            this.emit('task:status_updated', taskId, status);
        }
    }

    private handleTaskAssignment(taskId: string, agentId: string): void {
        this.updateTaskStatus(taskId, 'running');
        
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.status = 'busy';
            this.agents.set(agentId, agent);
        }
    }

    private handleTaskCompletion(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (task && task.targetAgent) {
            // Update agent status and load
            const agent = this.agents.get(task.targetAgent);
            if (agent) {
                agent.status = 'available';
                agent.currentLoad = {
                    memory: Math.max(0, agent.currentLoad.memory - task.resourceRequirements.memory),
                    cpu: Math.max(0, agent.currentLoad.cpu - task.resourceRequirements.cpu)
                };
                this.agents.set(task.targetAgent, agent);
            }
        }

        this.updateTaskStatus(taskId, 'completed');
        this.emit('task:completed', taskId);

        // Try to route any pending tasks
        Array.from(this.tasks.values())
            .filter(t => t.status === 'pending')
            .forEach(t => this.routeTask(t.id));
    }

    private handleTaskFailure(taskId: string, error: Error): void {
        const task = this.tasks.get(taskId);
        if (task && task.targetAgent) {
            // Update agent status and load
            const agent = this.agents.get(task.targetAgent);
            if (agent) {
                agent.status = 'available';
                agent.currentLoad = {
                    memory: Math.max(0, agent.currentLoad.memory - task.resourceRequirements.memory),
                    cpu: Math.max(0, agent.currentLoad.cpu - task.resourceRequirements.cpu)
                };
                this.agents.set(task.targetAgent, agent);
            }
        }

        this.updateTaskStatus(taskId, 'failed');
        this.emit('task:failed', taskId, error);

        // Try to route any pending tasks
        Array.from(this.tasks.values())
            .filter(t => t.status === 'pending')
            .forEach(t => this.routeTask(t.id));
    }

    public getTaskStatus(taskId: string): Task['status'] | undefined {
        return this.tasks.get(taskId)?.status;
    }

    public getAgentStatus(agentId: string): Agent['status'] | undefined {
        return this.agents.get(agentId)?.status;
    }

    public async getSystemMetrics() {
        const metrics = await this.resourceManager.getEnhancedMetrics();
        const utilization = this.resourceManager.getResourceUtilization();

        return {
            resources: metrics,
            utilization,
            activeTaskCount: Array.from(this.tasks.values())
                .filter(task => task.status === 'running' || task.status === 'assigned').length,
            availableAgents: Array.from(this.agents.values())
                .filter(agent => agent.status === 'available').length,
            totalAgents: this.agents.size
        };
    }
}