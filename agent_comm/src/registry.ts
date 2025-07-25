import * as fs from 'fs/promises';
import * as path from 'path';

interface AgentCard {
    id: string;
    capabilities: string[];
    endpoint: string;
}

class AgentRegistry {
    private registry: Map<string, AgentCard> = new Map();
    private wellKnownDir: string;

    constructor(wellKnownDir: string) {
        this.wellKnownDir = wellKnownDir;
    }

    public registerAgent(agentCard: AgentCard): void {
        this.registry.set(agentCard.id, agentCard);
        console.log(`Registered agent: ${agentCard.id} at ${agentCard.endpoint}`);
    }

    public getAgent(id: string): AgentCard | undefined {
        return this.registry.get(id);
    }

    public listAgents(): AgentCard[] {
        return Array.from(this.registry.values());
    }

    public deregisterAgent(id: string): void {
        this.registry.delete(id);
        console.log(`Deregistered agent: ${id}`);
    }
}

export const agentRegistry = new AgentRegistry(path.resolve(__dirname, '../.well-known'));
