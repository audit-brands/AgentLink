import { EventEmitter } from 'events';
import { EnhancedResourceManager } from './enhancedResourceManager';
import { WorkflowEngine } from './workflowEngine';

export interface AgentMessage {
    id: string;
    type: 'request' | 'response' | 'event' | 'error';
    source: string;
    target?: string;
    payload: unknown;
    timestamp: Date;
    correlationId?: string;
}

export interface AgentCapabilities {
    supportedTasks: string[];
    resourceCapacity: {
        memory: number;
        cpu: number;
    };
    status: 'available' | 'busy' | 'offline';
    version: string;
    features: string[];
}

export interface Agent {
    id: string;
    name: string;
    capabilities: AgentCapabilities;
    lastSeen: Date;
    currentLoad: {
        memory: number;
        cpu: number;
        tasks: number;
    };
}

export interface AgentTaskAssignment {
    taskId: string;
    agentId: string;
    workflowId: string;
    assignedAt: Date;
    resourceAllocation: {
        memory: number;
        cpu: number;
    };
}

/**
 * Manages agent communication, resource allocation, and task distribution
 */
export class AgentCommunicationService extends EventEmitter {
    private agents: Map<string, Agent>;
    private taskAssignments: Map<string, AgentTaskAssignment>;
    private messageQueue: Map<string, AgentMessage[]>;
    private resourceManager: EnhancedResourceManager;
    private workflowEngine: WorkflowEngine;

    constructor(resourceManager: EnhancedResourceManager, workflowEngine: WorkflowEngine) {
        super();
        this.agents = new Map();
        this.taskAssignments = new Map();
        this.messageQueue = new Map();
        this.resourceManager = resourceManager;
        this.workflowEngine = workflowEngine;

        this.setupWorkflowListeners();
    }

    /**
     * Registers a new agent with the system
     */
    public registerAgent(agent: Agent): void {
        this.agents.set(agent.id, agent);
        this.messageQueue.set(agent.id, []);
        this.emit('agent:registered', { agentId: agent.id, capabilities: agent.capabilities });
    }

    /**
     * Updates agent status and capabilities
     */
    public updateAgentStatus(
        agentId: string,
        status: Agent['capabilities']['status'],
        currentLoad?: Agent['currentLoad']
    ): void {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        agent.capabilities.status = status;
        if (currentLoad) {
            agent.currentLoad = currentLoad;
        }
        agent.lastSeen = new Date();

        // Ensure non-negative values
        agent.currentLoad.memory = Math.max(0, agent.currentLoad.memory);
        agent.currentLoad.cpu = Math.max(0, agent.currentLoad.cpu);
        agent.currentLoad.tasks = Math.max(0, agent.currentLoad.tasks);

        this.emit('agent:status_updated', {
            agentId,
            status,
            currentLoad: agent.currentLoad
        });
    }

    /**
     * Sends a message to a specific agent
     */
    public async sendMessage(message: AgentMessage): Promise<void> {
        if (!message.target) {
            throw new Error('Message target is required');
        }

        // Allow system as a target for responses
        if (message.target !== 'system') {
            const targetAgent = this.agents.get(message.target);
            if (!targetAgent) {
                throw new Error(`Target agent ${message.target} not found`);
            }

            const queue = this.messageQueue.get(message.target) || [];
            queue.push(message);
            this.messageQueue.set(message.target, queue);

            // Process message immediately for testing purposes
            if (message.type === 'request') {
                await this.handleRequest(message, targetAgent);
            } else if (message.type === 'response') {
                await this.handleResponse(message, targetAgent);
            } else if (message.type === 'event') {
                await this.handleEvent(message, targetAgent);
            } else if (message.type === 'error') {
                await this.handleError(message, targetAgent);
            }
        } else if (message.type === 'response') {
            // Handle system-targeted responses
            const sourceAgent = this.agents.get(message.source);
            if (sourceAgent) {
                await this.handleResponse(message, sourceAgent);
            }
        }

        this.emit('message:sent', {
            messageId: message.id,
            target: message.target,
            type: message.type
        });
    }

    /**
     * Assigns a task to an available agent
     */
    public async assignTask(
        taskId: string,
        workflowId: string,
        resourceRequirements: {
            memory: number;
            cpu: number;
        }
    ): Promise<string> {
        const availableAgent = await this.findAvailableAgent(resourceRequirements);
        if (!availableAgent) {
            throw new Error('No available agents found for task');
        }

        const assignment: AgentTaskAssignment = {
            taskId,
            agentId: availableAgent.id,
            workflowId,
            assignedAt: new Date(),
            resourceAllocation: resourceRequirements
        };

        this.taskAssignments.set(taskId, assignment);
        availableAgent.currentLoad.tasks++;
        availableAgent.currentLoad.memory += resourceRequirements.memory;
        availableAgent.currentLoad.cpu += resourceRequirements.cpu;

        this.emit('task:assigned', {
            taskId,
            agentId: availableAgent.id,
            workflowId,
            resourceAllocation: resourceRequirements
        });

        return availableAgent.id;
    }

    /**
     * Retrieves current agent status
     */
    public getAgentStatus(agentId: string): Agent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Lists all registered agents
     */
    public listAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Gets all task assignments for an agent
     */
    public getAgentAssignments(agentId: string): AgentTaskAssignment[] {
        return Array.from(this.taskAssignments.values())
            .filter(assignment => assignment.agentId === agentId);
    }

    private async findAvailableAgent(resourceRequirements: {
        memory: number;
        cpu: number;
    }): Promise<Agent | undefined> {
        const availableAgents = Array.from(this.agents.values())
            .filter(agent => {
                const hasCapacity = 
                    agent.currentLoad.memory + resourceRequirements.memory <= agent.capabilities.resourceCapacity.memory &&
                    agent.currentLoad.cpu + resourceRequirements.cpu <= agent.capabilities.resourceCapacity.cpu;
                
                return agent.capabilities.status === 'available' && hasCapacity;
            });

        if (availableAgents.length === 0) {
            return undefined;
        }

        // Select agent with lowest current load
        return availableAgents.reduce((best, current) => {
            const bestLoad = best.currentLoad.cpu / best.capabilities.resourceCapacity.cpu +
                           best.currentLoad.memory / best.capabilities.resourceCapacity.memory;
            const currentLoad = current.currentLoad.cpu / current.capabilities.resourceCapacity.cpu +
                              current.currentLoad.memory / current.capabilities.resourceCapacity.memory;
            return currentLoad < bestLoad ? current : best;
        });
    }

    private async processMessageQueue(agentId: string): Promise<void> {
        const queue = this.messageQueue.get(agentId);
        if (!queue || queue.length === 0) return;

        const agent = this.agents.get(agentId);
        if (!agent || agent.capabilities.status !== 'available') return;

        const message = queue.shift();
        if (!message) return;

        try {
            // Process message based on type
            switch (message.type) {
                case 'request':
                    await this.handleRequest(message, agent);
                    break;
                case 'response':
                    await this.handleResponse(message, agent);
                    break;
                case 'event':
                    await this.handleEvent(message, agent);
                    break;
                case 'error':
                    await this.handleError(message, agent);
                    break;
            }

            this.messageQueue.set(agentId, queue);
            this.emit('message:processed', {
                messageId: message.id,
                agentId,
                type: message.type
            });
        } catch (error) {
            this.emit('message:processing_error', {
                messageId: message.id,
                agentId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async handleRequest(message: AgentMessage, agent: Agent): Promise<void> {
        // Handle resource allocation for request
        const resourceCheck = await this.resourceManager.canHandleTask({
            memory: agent.currentLoad.memory,
            cpu: agent.currentLoad.cpu
        });

        if (!resourceCheck) {
            throw new Error('Insufficient resources to handle request');
        }

        this.emit('request:received', {
            messageId: message.id,
            agentId: agent.id,
            payload: message.payload
        });
    }

    private async handleResponse(message: AgentMessage, agent: Agent): Promise<void> {
        if (message.correlationId) {
            // Update workflow if response is part of a workflow
            const assignment = Array.from(this.taskAssignments.values())
                .find(a => a.taskId === message.correlationId);
            
            if (assignment) {
                this.emit('task:completed', {
                    taskId: assignment.taskId,
                    agentId: agent.id,
                    workflowId: assignment.workflowId,
                    result: message.payload
                });

                // Update agent load
                agent.currentLoad.memory -= assignment.resourceAllocation.memory;
                agent.currentLoad.cpu -= assignment.resourceAllocation.cpu;
                agent.currentLoad.tasks--;

                // Remove completed task assignment
                this.taskAssignments.delete(assignment.taskId);
            }
        }

        this.emit('response:received', {
            messageId: message.id,
            agentId: agent.id,
            correlationId: message.correlationId,
            payload: message.payload
        });
    }

    private async handleEvent(message: AgentMessage, agent: Agent): Promise<void> {
        this.emit('event:received', {
            messageId: message.id,
            agentId: agent.id,
            type: message.type,
            payload: message.payload
        });
    }

    private async handleError(message: AgentMessage, agent: Agent): Promise<void> {
        if (message.correlationId) {
            // Update workflow if error is part of a workflow
            const assignment = Array.from(this.taskAssignments.values())
                .find(a => a.taskId === message.correlationId);
            
            if (assignment) {
                this.emit('task:failed', {
                    taskId: assignment.taskId,
                    agentId: agent.id,
                    workflowId: assignment.workflowId,
                    error: message.payload
                });
            }
        }

        this.emit('error:received', {
            messageId: message.id,
            agentId: agent.id,
            correlationId: message.correlationId,
            error: message.payload
        });
    }

    private setupWorkflowListeners(): void {
        this.workflowEngine.on('workflow:step:started', async (event) => {
            const { workflowId, step } = event;
            if (step.resourceRequirements) {
                try {
                    await this.assignTask(step.id, workflowId, {
                        memory: step.resourceRequirements.memory || 0,
                        cpu: step.resourceRequirements.cpu || 0
                    });
                } catch (error) {
                    this.emit('workflow:resource_allocation_failed', {
                        workflowId,
                        stepId: step.id,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });

        this.workflowEngine.on('workflow:completed', (event) => {
            const { workflowId } = event;
            // Cleanup task assignments for completed workflow
            const workflowAssignments = Array.from(this.taskAssignments.values())
                .filter(assignment => assignment.workflowId === workflowId);
            
            for (const assignment of workflowAssignments) {
                this.taskAssignments.delete(assignment.taskId);
            }
        });
    }
}