import { TaskRouter, AgentTask, AgentRegistry, AgentStatus, RegisteredAgent } from '../types/orchestration';
import { ResourceManager } from './resourceManager';

interface RoutingMetrics {
    taskCount: number;
    successRate: number;
    averageLatency: number;
    lastUsed: number;
}

interface AgentMetrics extends RoutingMetrics {
    resourceUsage: {
        cpu: number;
        memory: number;
    };
    capabilities: Set<string>;
}

/**
 * Enhanced TaskRouter with load balancing and resource awareness
 */
export class EnhancedTaskRouter implements TaskRouter {
    private agentMetrics: Map<string, AgentMetrics> = new Map();
    private routingHistory: Map<string, RoutingMetrics> = new Map();
    private healthCheckInterval?: NodeJS.Timeout;

    constructor(
        private registry: AgentRegistry,
        private resourceManager: ResourceManager,
        private config: {
            healthCheckInterval: number;
            loadBalancingWindow: number;
            maxRetries: number;
        }
    ) {
        this.startHealthChecks();
    }

    cleanup(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }

    async route(task: AgentTask): Promise<string> {
        // If target agent is specified and can handle the task, use it
        if (task.targetAgent) {
            const canHandle = await this.canHandle(task);
            if (canHandle) {
                return task.targetAgent;
            }
            throw new Error(`Target agent ${task.targetAgent} cannot handle task ${task.method}`);
        }

        // Get all capable agents
        const agents = await this.getCapableAgents(task);
        if (agents.length === 0) {
            throw new Error(`No agent found capable of handling task ${task.method}`);
        }

        // Score agents based on multiple factors
        const scoredAgents = await this.scoreAgents(agents, task);
        
        // Select the best agent
        const selectedAgent = scoredAgents[0];
        
        // Update routing metrics
        this.updateRoutingMetrics(selectedAgent.id, task);

        return selectedAgent.id;
    }

    async canHandle(task: AgentTask): Promise<boolean> {
        if (!task.targetAgent) {
            return false;
        }

        const agent = await this.registry.getAgent(task.targetAgent);
        if (!agent || agent.status !== AgentStatus.ONLINE) {
            return false;
        }

        // Check both capability and resource availability
        const hasCapability = agent.capabilities.some(cap => 
            cap.methods.includes(task.method)
        );

        if (!hasCapability) {
            return false;
        }

        // Get agent metrics
        const metrics = this.agentMetrics.get(agent.id);
        if (!metrics) {
            return true; // No metrics yet, assume can handle
        }

        // Check resource availability
        const resourceThreshold = 0.9; // 90% utilization threshold
        return metrics.resourceUsage.cpu < resourceThreshold &&
               metrics.resourceUsage.memory < resourceThreshold;
    }

    private async getCapableAgents(task: AgentTask): Promise<RegisteredAgent[]> {
        const agents = await this.registry.listAgents();
        return agents.filter(agent => 
            agent.status === AgentStatus.ONLINE &&
            agent.capabilities.some(cap => cap.methods.includes(task.method))
        );
    }

    private async scoreAgents(agents: RegisteredAgent[], task: AgentTask): Promise<RegisteredAgent[]> {
        const scores = await Promise.all(agents.map(async agent => {
            const metrics = this.agentMetrics.get(agent.id);
            if (!metrics) {
                return { agent, score: 0.5 }; // Default score for new agents
            }

            // Calculate score based on multiple factors
            let score = 0;

            // Resource availability (30%)
            const resourceScore = 1 - Math.max(
                metrics.resourceUsage.cpu,
                metrics.resourceUsage.memory
            );
            score += resourceScore * 0.3;

            // Success rate (25%)
            score += metrics.successRate * 0.25;

            // Load balancing (20%)
            const timeSinceLastUse = Date.now() - metrics.lastUsed;
            const loadScore = Math.min(timeSinceLastUse / this.config.loadBalancingWindow, 1);
            score += loadScore * 0.2;

            // Latency (15%)
            const latencyScore = Math.max(0, 1 - (metrics.averageLatency / 1000));
            score += latencyScore * 0.15;

            // Capability match (10%)
            const capabilityScore = agent.capabilities.reduce((score, cap) => {
                return score + (cap.methods.includes(task.method) ? 1 : 0);
            }, 0) / agent.capabilities.length;
            score += capabilityScore * 0.1;

            return { agent, score };
        }));

        // Sort by score descending
        return scores
            .sort((a, b) => b.score - a.score)
            .map(s => s.agent);
    }

    private updateRoutingMetrics(agentId: string, task: AgentTask): void {
        const now = Date.now();
        const metrics = this.agentMetrics.get(agentId) || {
            taskCount: 0,
            successRate: 1,
            averageLatency: 0,
            lastUsed: now,
            resourceUsage: { cpu: 0, memory: 0 },
            capabilities: new Set()
        };

        metrics.taskCount++;
        metrics.lastUsed = now;
        this.agentMetrics.set(agentId, metrics);

        // Update routing history
        const routingKey = `${task.method}:${agentId}`;
        const routingMetrics = this.routingHistory.get(routingKey) || {
            taskCount: 0,
            successRate: 1,
            averageLatency: 0,
            lastUsed: now
        };

        routingMetrics.taskCount++;
        routingMetrics.lastUsed = now;
        this.routingHistory.set(routingKey, routingMetrics);
    }

    private startHealthChecks(): void {
        const checkAgentHealth = async () => {
            const agents = await this.registry.listAgents();
            
            for (const agent of agents) {
                try {
                    // Check agent health
                    const response = await fetch(`${agent.endpoint}/health`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        this.handleAgentFailure(agent.id);
                        continue;
                    }

                    const health = await response.json();
                    
                    // Update metrics
                    const metrics = this.agentMetrics.get(agent.id) || {
                        taskCount: 0,
                        successRate: 1,
                        averageLatency: 0,
                        lastUsed: Date.now(),
                        resourceUsage: { cpu: 0, memory: 0 },
                        capabilities: new Set(
                            agent.capabilities.flatMap(cap => cap.methods)
                        )
                    };

                    metrics.resourceUsage = {
                        cpu: health.cpu || 0,
                        memory: health.memory || 0
                    };

                    // Update success rate based on recent task completion
                    const recentTaskCount = health.recentTasks?.total || 0;
                    const successfulTasks = health.recentTasks?.successful || 0;
                    if (recentTaskCount > 0) {
                        metrics.successRate = successfulTasks / recentTaskCount;
                    }

                    // Update latency metrics
                    if (health.averageLatency) {
                        metrics.averageLatency = health.averageLatency;
                    }

                    this.agentMetrics.set(agent.id, metrics);

                } catch (error) {
                    this.handleAgentFailure(agent.id);
                }
            }
        };

        this.healthCheckInterval = setInterval(
            checkAgentHealth,
            this.config.healthCheckInterval
        );
    }

    private handleAgentFailure(agentId: string): void {
        // Update metrics to reflect failure
        const metrics = this.agentMetrics.get(agentId);
        if (metrics) {
            metrics.successRate *= 0.5; // Reduce success rate
            metrics.resourceUsage = {
                cpu: 1, // Mark as fully utilized
                memory: 1
            };
            this.agentMetrics.set(agentId, metrics);
        }
    }

    getAgentMetrics(agentId: string): AgentMetrics | undefined {
        return this.agentMetrics.get(agentId);
    }

    getRoutingMetrics(method: string, agentId: string): RoutingMetrics | undefined {
        return this.routingHistory.get(`${method}:${agentId}`);
    }
}