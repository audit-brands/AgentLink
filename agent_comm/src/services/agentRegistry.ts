import { AgentRegistry, RegisteredAgent, AgentStatus } from '../types/orchestration';

/**
 * In-memory implementation of AgentRegistry for basic orchestration
 * Will be replaced with persistent storage in later phases
 */
export class InMemoryAgentRegistry implements AgentRegistry {
    private agents: Map<string, RegisteredAgent> = new Map();

    async register(agent: RegisteredAgent): Promise<void> {
        if (this.agents.has(agent.id)) {
            throw new Error(`Agent with ID ${agent.id} is already registered`);
        }
        this.agents.set(agent.id, {
            ...agent,
            status: AgentStatus.ONLINE,
            lastSeen: agent.lastSeen || new Date()
        });
    }

    async unregister(agentId: string): Promise<void> {
        if (!this.agents.has(agentId)) {
            throw new Error(`Agent with ID ${agentId} not found`);
        }
        this.agents.delete(agentId);
    }

    async getAgent(agentId: string): Promise<RegisteredAgent | null> {
        return this.agents.get(agentId) || null;
    }

    async listAgents(): Promise<RegisteredAgent[]> {
        return Array.from(this.agents.values());
    }

    async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
        const agent = await this.getAgent(agentId);
        if (!agent) {
            throw new Error(`Agent with ID ${agentId} not found`);
        }
        this.agents.set(agentId, {
            ...agent,
            status,
            lastSeen: new Date()
        });
    }
}