import { TaskRouter, AgentTask, AgentRegistry } from '../types/orchestration';

/**
 * Basic implementation of TaskRouter for orchestration
 * Routes tasks based on agent capabilities and availability
 */
export class SimpleTaskRouter implements TaskRouter {
    constructor(private registry: AgentRegistry) {}

    async route(task: AgentTask): Promise<string> {
        // If target agent is specified, validate it can handle the task
        if (task.targetAgent) {
            const canHandle = await this.canHandle(task);
            if (canHandle) {
                return task.targetAgent;
            }
            throw new Error(`Target agent ${task.targetAgent} cannot handle task ${task.method}`);
        }

        // Find first available agent that can handle the task
        const agents = await this.registry.listAgents();
        for (const agent of agents) {
            const capability = agent.capabilities.find(cap => 
                cap.methods.includes(task.method)
            );
            if (capability) {
                return agent.id;
            }
        }

        throw new Error(`No agent found capable of handling task ${task.method}`);
    }

    async canHandle(task: AgentTask): Promise<boolean> {
        if (!task.targetAgent) {
            return false;
        }

        const agent = await this.registry.getAgent(task.targetAgent);
        if (!agent) {
            return false;
        }

        return agent.capabilities.some(cap => 
            cap.methods.includes(task.method)
        );
    }
}