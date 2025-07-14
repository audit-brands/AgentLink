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

    public async discoverAgents(): Promise<void> {
        try {
            const files = await fs.readdir(this.wellKnownDir);
            for (const file of files) {
                if (file.endsWith('_agent.json')) {
                    const filePath = path.join(this.wellKnownDir, file);
                    const content = await fs.readFile(filePath, 'utf-8');
                    const agentCard: AgentCard = JSON.parse(content);
                    this.registry.set(agentCard.id, agentCard);
                    console.log(`Discovered agent: ${agentCard.id} at ${agentCard.endpoint}`);
                }
            }
        } catch (error) {
            console.error(`Error discovering agents: ${error}`);
        }
    }

    public getAgent(id: string): AgentCard | undefined {
        return this.registry.get(id);
    }

    public listAgents(): AgentCard[] {
        return Array.from(this.registry.values());
    }
}

export const agentRegistry = new AgentRegistry(path.resolve(__dirname, '../.well-known'));
