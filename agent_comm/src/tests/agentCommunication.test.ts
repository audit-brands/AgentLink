import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { WorkflowEngine } from '../services/workflowEngine';
import { AgentCommunicationService, Agent, AgentMessage } from '../services/agentCommunication';

describe('AgentCommunicationService', () => {
    let resourceManager: EnhancedResourceManager;
    let workflowEngine: WorkflowEngine;
    let communicationService: AgentCommunicationService;

    const mockLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024 // 768MB
        },
        cpu: {
            maxUsage: 90,
            warning: 70
        }
    };

    const mockAgent: Agent = {
        id: 'test-agent-1',
        name: 'Test Agent',
        capabilities: {
            supportedTasks: ['task1', 'task2'],
            resourceCapacity: {
                memory: 512 * 1024 * 1024, // 512MB
                cpu: 50 // 50%
            },
            status: 'available',
            version: '1.0.0',
            features: ['feature1', 'feature2']
        },
        lastSeen: new Date(),
        currentLoad: {
            memory: 0,
            cpu: 0,
            tasks: 0
        }
    };

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(mockLimits);
        workflowEngine = new WorkflowEngine(resourceManager);
        communicationService = new AgentCommunicationService(resourceManager, workflowEngine);
        
        // Reset mock agent to initial state
        mockAgent.capabilities.status = 'available';
        mockAgent.currentLoad = {
            memory: 0,
            cpu: 0,
            tasks: 0
        };
        mockAgent.lastSeen = new Date();
    });

    describe('Agent Management', () => {
        it('should register new agents', () => {
            communicationService.registerAgent(mockAgent);
            const agent = communicationService.getAgentStatus(mockAgent.id);
            
            expect(agent).toBeDefined();
            expect(agent?.id).toBe(mockAgent.id);
            expect(agent?.capabilities).toEqual(mockAgent.capabilities);
        });

        it('should update agent status', () => {
            communicationService.registerAgent(mockAgent);
            communicationService.updateAgentStatus(mockAgent.id, 'busy', {
                memory: 256 * 1024 * 1024,
                cpu: 25,
                tasks: 1
            });

            const agent = communicationService.getAgentStatus(mockAgent.id);
            expect(agent?.capabilities.status).toBe('busy');
            expect(agent?.currentLoad.memory).toBe(256 * 1024 * 1024);
            expect(agent?.currentLoad.cpu).toBe(25);
            expect(agent?.currentLoad.tasks).toBe(1);
        });

        it('should list all registered agents', () => {
            communicationService.registerAgent(mockAgent);
            const agents = communicationService.listAgents();
            
            expect(agents).toHaveLength(1);
            expect(agents[0].id).toBe(mockAgent.id);
        });
    });

    describe('Message Handling', () => {
        it('should send messages to agents', async () => {
            communicationService.registerAgent(mockAgent);
            const message: AgentMessage = {
                id: 'msg-1',
                type: 'request',
                source: 'system',
                target: mockAgent.id,
                payload: { action: 'test' },
                timestamp: new Date()
            };

            const messageSent = vi.fn();
            communicationService.on('message:sent', messageSent);

            await communicationService.sendMessage(message);
            expect(messageSent).toHaveBeenCalledWith({
                messageId: message.id,
                target: mockAgent.id,
                type: message.type
            });
        });

        it('should handle request messages', async () => {
            communicationService.registerAgent(mockAgent);
            const message: AgentMessage = {
                id: 'msg-1',
                type: 'request',
                source: 'system',
                target: mockAgent.id,
                payload: { action: 'test' },
                timestamp: new Date()
            };

            const requestReceived = vi.fn();
            communicationService.on('request:received', requestReceived);

            await communicationService.sendMessage(message);
            expect(requestReceived).toHaveBeenCalledWith({
                messageId: message.id,
                agentId: mockAgent.id,
                payload: message.payload
            });
        });

        it('should handle response messages', async () => {
            communicationService.registerAgent(mockAgent);
            const message: AgentMessage = {
                id: 'msg-1',
                type: 'response',
                source: mockAgent.id,
                target: 'system',
                payload: { result: 'success' },
                timestamp: new Date(),
                correlationId: 'task-1'
            };

            const responseReceived = vi.fn();
            communicationService.on('response:received', responseReceived);

            await communicationService.sendMessage(message);
            expect(responseReceived).toHaveBeenCalledWith({
                messageId: message.id,
                agentId: mockAgent.id,
                correlationId: message.correlationId,
                payload: message.payload
            });
        });
    });

    describe('Task Assignment', () => {
        it('should assign tasks to available agents', async () => {
            communicationService.registerAgent(mockAgent);
            const taskAssigned = vi.fn();
            communicationService.on('task:assigned', taskAssigned);

            const agentId = await communicationService.assignTask('task-1', 'workflow-1', {
                memory: 256 * 1024 * 1024,
                cpu: 25
            });

            expect(agentId).toBe(mockAgent.id);
            expect(taskAssigned).toHaveBeenCalledWith({
                taskId: 'task-1',
                agentId: mockAgent.id,
                workflowId: 'workflow-1',
                resourceAllocation: {
                    memory: 256 * 1024 * 1024,
                    cpu: 25
                }
            });
        });

        it('should track agent task assignments', async () => {
            communicationService.registerAgent(mockAgent);
            await communicationService.assignTask('task-1', 'workflow-1', {
                memory: 256 * 1024 * 1024,
                cpu: 25
            });

            const assignments = communicationService.getAgentAssignments(mockAgent.id);
            expect(assignments).toHaveLength(1);
            expect(assignments[0].taskId).toBe('task-1');
            expect(assignments[0].workflowId).toBe('workflow-1');
        });

        it('should reject tasks when resources are insufficient', async () => {
            communicationService.registerAgent(mockAgent);
            await expect(communicationService.assignTask('task-1', 'workflow-1', {
                memory: 2 * 1024 * 1024 * 1024, // 2GB
                cpu: 100
            })).rejects.toThrow('No available agents found for task');
        });

        it('should handle task completion', async () => {
            communicationService.registerAgent(mockAgent);
            const taskId = 'task-1';
            const workflowId = 'workflow-1';

            await communicationService.assignTask(taskId, workflowId, {
                memory: 256 * 1024 * 1024,
                cpu: 25
            });

            const message: AgentMessage = {
                id: 'msg-1',
                type: 'response',
                source: mockAgent.id,
                target: 'system',
                payload: { result: 'success' },
                timestamp: new Date(),
                correlationId: taskId
            };

            const taskCompleted = vi.fn();
            communicationService.on('task:completed', taskCompleted);

            await communicationService.sendMessage(message);
            expect(taskCompleted).toHaveBeenCalledWith({
                taskId,
                agentId: mockAgent.id,
                workflowId,
                result: message.payload
            });
        });
    });

    describe('Resource Management', () => {
        it('should track agent resource usage', async () => {
            communicationService.registerAgent(mockAgent);
            await communicationService.assignTask('task-1', 'workflow-1', {
                memory: 256 * 1024 * 1024,
                cpu: 25
            });

            const agent = communicationService.getAgentStatus(mockAgent.id);
            expect(agent?.currentLoad.memory).toBe(256 * 1024 * 1024);
            expect(agent?.currentLoad.cpu).toBe(25);
            expect(agent?.currentLoad.tasks).toBe(1);
        });

        it('should select least loaded agent for task assignment', async () => {
            const agent2: Agent = {
                ...mockAgent,
                id: 'test-agent-2',
                currentLoad: {
                    memory: 128 * 1024 * 1024,
                    cpu: 10,
                    tasks: 1
                }
            };

            communicationService.registerAgent(mockAgent);
            communicationService.registerAgent(agent2);

            const agentId = await communicationService.assignTask('task-1', 'workflow-1', {
                memory: 256 * 1024 * 1024,
                cpu: 25
            });

            expect(agentId).toBe(mockAgent.id); // Should choose the agent with lower load
        });
    });
});