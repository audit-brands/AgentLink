import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentRegistry } from '../services/agentRegistry';
import { RegisteredAgent, AgentStatus, AgentCapability } from '../types/orchestration';

describe('InMemoryAgentRegistry', () => {
    let registry: InMemoryAgentRegistry;
    let mockAgent: RegisteredAgent;
    let mockCapability: AgentCapability;

    beforeEach(() => {
        registry = new InMemoryAgentRegistry();
        mockCapability = {
            name: 'test-capability',
            methods: ['test-method'],
            version: '1.0.0'
        };
        mockAgent = {
            id: 'test-agent',
            name: 'Test Agent',
            endpoint: 'http://localhost:3000',
            capabilities: [mockCapability],
            status: AgentStatus.ONLINE,
            lastSeen: new Date()
        };
    });

    it('should register a new agent successfully', async () => {
        await registry.register(mockAgent);
        const retrieved = await registry.getAgent(mockAgent.id);
        expect(retrieved).toMatchObject(mockAgent);
    });

    it('should prevent duplicate agent registration', async () => {
        await registry.register(mockAgent);
        await expect(registry.register(mockAgent))
            .rejects.toThrow('Agent with ID test-agent is already registered');
    });

    it('should unregister an agent successfully', async () => {
        await registry.register(mockAgent);
        await registry.unregister(mockAgent.id);
        const retrieved = await registry.getAgent(mockAgent.id);
        expect(retrieved).toBeNull();
    });

    it('should fail to unregister non-existent agent', async () => {
        await expect(registry.unregister('non-existent'))
            .rejects.toThrow('Agent with ID non-existent not found');
    });

    it('should list all registered agents', async () => {
        await registry.register(mockAgent);
        await registry.register({
            ...mockAgent,
            id: 'test-agent-2',
            name: 'Test Agent 2'
        });

        const agents = await registry.listAgents();
        expect(agents).toHaveLength(2);
        expect(agents.map(a => a.id)).toContain('test-agent');
        expect(agents.map(a => a.id)).toContain('test-agent-2');
    });

    it('should update agent status', async () => {
        await registry.register(mockAgent);
        await registry.updateStatus(mockAgent.id, AgentStatus.BUSY);
        
        const updated = await registry.getAgent(mockAgent.id);
        expect(updated?.status).toBe(AgentStatus.BUSY);
    });

    it('should fail to update status of non-existent agent', async () => {
        await expect(registry.updateStatus('non-existent', AgentStatus.BUSY))
            .rejects.toThrow('Agent with ID non-existent not found');
    });

    it('should update lastSeen timestamp on status update', async () => {
        await registry.register(mockAgent);
        const beforeUpdate = (await registry.getAgent(mockAgent.id))?.lastSeen;
        
        // Small delay to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 1));
        
        await registry.updateStatus(mockAgent.id, AgentStatus.BUSY);
        const afterUpdate = (await registry.getAgent(mockAgent.id))?.lastSeen;
        
        expect(afterUpdate?.getTime()).toBeGreaterThan(beforeUpdate?.getTime() || 0);
    });
});