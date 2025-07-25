import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnhancedOrchestrator, Task, Agent } from '../services/enhancedOrchestrator';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { ResourceAwareTaskRouter } from '../services/resourceAwareTaskRouter';
import { ResourceLimits } from '../services/resourceManager';

describe('ResourceAwareOrchestrator Integration Tests', () => {
    let orchestrator: EnhancedOrchestrator;
    let resourceManager: EnhancedResourceManager;
    let taskRouter: ResourceAwareTaskRouter;

    const mockLimits: ResourceLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024, // 768MB
        },
        cpu: {
            maxUsage: 80, // 80%
            warning: 70, // 70%
        },
    };

    const createMockTask = (id: string, memory: number, cpu: number): Omit<Task, 'status'> => ({
        id,
        type: 'test',
        priority: 1,
        resourceRequirements: {
            memory,
            cpu,
        },
    });

    const createMockAgent = (id: string, memory: number, cpu: number): Agent => ({
        id,
        capabilities: ['test'],
        status: 'available',
        currentLoad: {
            memory,
            cpu,
        },
    });

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(mockLimits);
        taskRouter = new ResourceAwareTaskRouter();
        orchestrator = new EnhancedOrchestrator(resourceManager, taskRouter);
    });

    describe('Resource Utilization', () => {
        it('should distribute tasks based on resource availability', async () => {
            const agent1 = createMockAgent('agent-1', 100 * 1024 * 1024, 10);
            const agent2 = createMockAgent('agent-2', 200 * 1024 * 1024, 20);
            
            orchestrator.registerAgent(agent1);
            orchestrator.registerAgent(agent2);

            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 300 * 1024 * 1024,
                    free: mockLimits.memory.max - 300 * 1024 * 1024,
                    processUsage: 300 * 1024 * 1024,
                    heapUsage: 300 * 1024 * 1024
                },
                cpu: {
                    usage: 30,
                    loadAvg: [30, 30, 30],
                    processUsage: 30
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 300 * 1024 * 1024,
                    cpu: 50
                },
                utilizationPercentages: {
                    memory: 30,
                    cpu: 30
                }
            });

            // Submit tasks with different resource requirements
            const task1 = createMockTask('task-1', 150 * 1024 * 1024, 15);
            const task2 = createMockTask('task-2', 250 * 1024 * 1024, 25);

            await orchestrator.submitTask(task1);
            await orchestrator.submitTask(task2);

            // Wait for task routing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify task distribution
            const metrics = await orchestrator.getSystemMetrics();
            expect(metrics.activeTaskCount).toBeGreaterThan(0);
            expect(metrics.availableAgents).toBeLessThan(2);
        });

        it('should respect resource limits when assigning tasks', async () => {
            const agent = createMockAgent('agent-1', 100 * 1024 * 1024, 10);
            orchestrator.registerAgent(agent);

            vi.spyOn(resourceManager, 'canHandleTask')
                .mockImplementation(async (requirements) => {
                    return requirements.memory <= mockLimits.memory.max - agent.currentLoad.memory &&
                           requirements.cpu <= mockLimits.cpu.maxUsage - agent.currentLoad.cpu;
                });

            // Try to submit a task that exceeds available resources
            const largeTask = createMockTask('large-task', mockLimits.memory.max, 90);
            await expect(orchestrator.submitTask(largeTask))
                .rejects.toThrow('Insufficient resources');
        });
    });

    describe('Load Balancing', () => {
        it('should balance tasks across available agents', async () => {
            const agents = [
                createMockAgent('agent-1', 100 * 1024 * 1024, 10),
                createMockAgent('agent-2', 150 * 1024 * 1024, 15),
                createMockAgent('agent-3', 200 * 1024 * 1024, 20),
            ];

            agents.forEach(agent => orchestrator.registerAgent(agent));

            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 450 * 1024 * 1024,
                    free: mockLimits.memory.max - 450 * 1024 * 1024,
                    processUsage: 450 * 1024 * 1024,
                    heapUsage: 450 * 1024 * 1024
                },
                cpu: {
                    usage: 45,
                    loadAvg: [45, 45, 45],
                    processUsage: 45
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 450 * 1024 * 1024,
                    cpu: 35
                },
                utilizationPercentages: {
                    memory: 45,
                    cpu: 45
                }
            });

            // Submit multiple tasks
            const tasks = [
                createMockTask('task-1', 100 * 1024 * 1024, 10),
                createMockTask('task-2', 150 * 1024 * 1024, 15),
                createMockTask('task-3', 200 * 1024 * 1024, 20),
            ];

            await Promise.all(tasks.map(task => orchestrator.submitTask(task)));

            // Wait for task routing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify distribution
            const metrics = await orchestrator.getSystemMetrics();
            expect(metrics.activeTaskCount).toBeGreaterThan(0);
            expect(metrics.availableAgents).toBeLessThan(agents.length);
        });
    });

    describe('Concurrent Processing', () => {
        it('should handle multiple concurrent task submissions', async () => {
            const agent = createMockAgent('agent-1', 100 * 1024 * 1024, 10);
            orchestrator.registerAgent(agent);

            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 100 * 1024 * 1024,
                    free: mockLimits.memory.max - 100 * 1024 * 1024,
                    processUsage: 100 * 1024 * 1024,
                    heapUsage: 100 * 1024 * 1024
                },
                cpu: {
                    usage: 10,
                    loadAvg: [10, 10, 10],
                    processUsage: 10
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 100 * 1024 * 1024,
                    cpu: 70
                },
                utilizationPercentages: {
                    memory: 10,
                    cpu: 10
                }
            });

            // Submit multiple tasks concurrently
            const tasks = Array.from({ length: 5 }, (_, i) => 
                createMockTask(`task-${i + 1}`, 50 * 1024 * 1024, 5)
            );

            const results = await Promise.all(tasks.map(task => orchestrator.submitTask(task)));
            expect(results).toHaveLength(tasks.length);

            // Wait for task routing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify all tasks were processed
            const metrics = await orchestrator.getSystemMetrics();
            expect(metrics.activeTaskCount).toBeGreaterThan(0);
        });
    });

    describe('Error Recovery', () => {
        it('should handle agent failure gracefully', async () => {
            const agent1 = createMockAgent('agent-1', 100 * 1024 * 1024, 10);
            const agent2 = createMockAgent('agent-2', 150 * 1024 * 1024, 15);
            
            orchestrator.registerAgent(agent1);
            orchestrator.registerAgent(agent2);

            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 250 * 1024 * 1024,
                    free: mockLimits.memory.max - 250 * 1024 * 1024,
                    processUsage: 250 * 1024 * 1024,
                    heapUsage: 250 * 1024 * 1024
                },
                cpu: {
                    usage: 25,
                    loadAvg: [25, 25, 25],
                    processUsage: 25
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 250 * 1024 * 1024,
                    cpu: 55
                },
                utilizationPercentages: {
                    memory: 25,
                    cpu: 25
                }
            });

            const task = createMockTask('task-1', 100 * 1024 * 1024, 10);
            await orchestrator.submitTask(task);

            // Simulate agent failure
            orchestrator.deregisterAgent(agent1.id);

            // Wait for recovery
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify system remains operational
            const metrics = await orchestrator.getSystemMetrics();
            expect(metrics.totalAgents).toBe(1);
            expect(metrics.availableAgents).toBe(1);
        });
    });

    describe('Resource Monitoring', () => {
        it('should track system-wide resource utilization', async () => {
            const agent = createMockAgent('agent-1', 100 * 1024 * 1024, 10);
            orchestrator.registerAgent(agent);

            vi.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 100 * 1024 * 1024,
                    free: mockLimits.memory.max - 100 * 1024 * 1024,
                    processUsage: 100 * 1024 * 1024,
                    heapUsage: 100 * 1024 * 1024
                },
                cpu: {
                    usage: 10,
                    loadAvg: [10, 10, 10],
                    processUsage: 10
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 100 * 1024 * 1024,
                    cpu: 70
                },
                utilizationPercentages: {
                    memory: 10,
                    cpu: 10
                }
            });

            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 10,
                cpu: 10
            });

            const task = createMockTask('task-1', 100 * 1024 * 1024, 10);
            await orchestrator.submitTask(task);

            const metrics = await orchestrator.getSystemMetrics();
            expect(metrics.resources).toBeDefined();
            expect(metrics.utilization).toBeDefined();
            expect(metrics.resources.availableResources.memory).toBeDefined();
            expect(metrics.resources.availableResources.cpu).toBeDefined();
            expect(metrics.utilization.memory).toBeDefined();
            expect(metrics.utilization.cpu).toBeDefined();
        });
    });
});