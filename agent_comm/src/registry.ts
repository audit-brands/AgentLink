import axios from 'axios';

interface AgentInfo {
    id: string;
    endpoint: string;
}

interface AgentCard {
    id: string;
    capabilities: string[];
    endpoint: string;
}

interface RegisteredAgent {
    endpoint: string;
    capabilities: string[];
    status: "active" | "inactive";
}

const AGENTS: AgentInfo[] = [
    { id: "claude-agent", endpoint: "http://localhost:5000" },
    { id: "gemini-agent", endpoint: "http://localhost:5001" }
];

const REGISTERED_AGENTS: { [key: string]: RegisteredAgent } = {};

async function discoverAgent(agentInfo: AgentInfo) {
    const { id: agentId, endpoint } = agentInfo;
    const agentJsonUrl = `${endpoint}/.well-known/agent.json`;
    
    try {
        const response = await axios.get<AgentCard>(agentJsonUrl, { timeout: 2000 });
        const agentCard = response.data;
        REGISTERED_AGENTS[agentId] = {
            endpoint: endpoint,
            capabilities: agentCard.capabilities || [],
            status: "active"
        };
        console.log(`[REGISTRY] Discovered and registered agent: ${agentId} with capabilities ${REGISTERED_AGENTS[agentId].capabilities}`);
    } catch (error: any) {
        if (error.isAxiosError) {
            if (agentId in REGISTERED_AGENTS) {
                REGISTERED_AGENTS[agentId].status = "inactive";
                console.log(`[REGISTRY] Agent ${agentId} became inactive: ${error.message}`);
            } else {
                console.log(`[REGISTRY] Agent ${agentId} is not reachable: ${error.message}`);
            }
        } else {
            console.error(`[REGISTRY] An unexpected error occurred for ${agentId}:`, error);
        }
    }
}

async function main() {
    console.log("[REGISTRY] Starting agent discovery service...");
    while (true) {
        for (const agentInfo of AGENTS) {
            await discoverAgent(agentInfo);
        }
        console.log("[REGISTRY] Current Registered Agents:");
        for (const agentId in REGISTERED_AGENTS) {
            const info = REGISTERED_AGENTS[agentId];
            console.log(`  - ${agentId}: Status=${info.status}, Capabilities=${info.capabilities.join(', ')}`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
    }
}

main();