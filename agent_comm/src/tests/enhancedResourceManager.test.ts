import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';

describe('EnhancedResourceManager', () => {
    let resourceManager: EnhancedResourceManager;

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager({
            memory: {
                max: 1024 * 1024 * 1024, // 1GB
                warning: 768 * 1024 * 1024 // 768MB
            },
            cpu: {
                maxUsage: 80,
                warning: 70
            }
        });
    });

    afterEach(() => {
        resourceManager.stop();
    });

    describe('Resource Metrics', () => {
        it('should provide enhanced metrics with cluster information', async () => {
            const metrics = await resourceManager.getEnhancedMetrics();
            
            expect(metrics.memory).toBeDefined();
            expect(metrics.cpu).toBeDefined();
            expect(metrics.availableResources).toBeDefined();
            expect(metrics.clusterMetrics).toBeDefined();
            
            // Verify memory metrics
            expect(metrics.memory.total).toBeGreaterThan(0);
            expect(metrics.memory.free).toBeGreaterThan(0);
            expect(metrics.memory.used).toBeLessThan(metrics.memory.total);
            
            // Verify CPU metrics
            expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
            expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
            expect(metrics.cpu.loadAvg).toHaveLength(3);
            
            // Verify cluster metrics
            expect(metrics.clusterMetrics.nodeCount).toBe(1); // Local node only
            expect(metrics.clusterMetrics.totalMemory).toBeGreaterThan(0);
            expect(metrics.clusterMetrics.totalCpu).toBe(100);
        });

        it('should track resource utilization', () => {
            const utilization = resourceManager.getResourceUtilization();
            
            expect(utilization.memory).toBeGreaterThanOrEqual(0);
            expect(utilization.memory).toBeLessThanOrEqual(100);
            expect(utilization.cpu).toBeGreaterThanOrEqual(0);
            expect(utilization.cpu).toBeLessThanOrEqual(100);
        });
    });

    describe('Resource Reservation', () => {
        it('should reserve resources for tasks', async () => {
            const taskId = 'test-task';
            const request = {
                memory: 256 * 1024 * 1024, // 256MB
                cpu: 20
            };

            const canHandle = await resourceManager.canHandleTask(request);
            expect(canHandle).toBe(true);

            const reserved = await resourceManager.reserveResources(taskId, request);
            expect(reserved).toBe(true);

            const metrics = await resourceManager.getEnhancedMetrics();
            expect(metrics.availableResources.memory).toBeLessThan(resourceManager.limits.memory.max);
            expect(metrics.availableResources.cpu).toBeLessThan(resourceManager.limits.cpu.maxUsage);
        });

        it('should release reserved resources', async () => {
            const taskId = 'test-task';
            const request = {
                memory: 256 * 1024 * 1024,
                cpu: 20
            };

            await resourceManager.reserveResources(taskId, request);
            const beforeRelease = await resourceManager.getEnhancedMetrics();

            resourceManager.releaseResources(taskId);
            const afterRelease = await resourceManager.getEnhancedMetrics();

            // Available resources should increase after release
            expect(afterRelease.availableResources.memory)
                .toBeGreaterThan(beforeRelease.availableResources.memory);
            expect(afterRelease.availableResources.cpu)
                .toBeGreaterThan(beforeRelease.availableResources.cpu - 20);
        });

        it('should prevent over-allocation of resources', async () => {
            const request = {
                memory: 2 * 1024 * 1024 * 1024, // 2GB (more than limit)
                cpu: 90 // More than max usage
            };

            const canHandle = await resourceManager.canHandleTask(request);
            expect(canHandle).toBe(false);

            const reserved = await resourceManager.reserveResources('test-task', request);
            expect(reserved).toBe(false);
        });
    });

    describe('Cluster Management', () => {
        it('should manage cluster nodes', async () => {
            const nodeId = 'test-node';
            const nodeMetrics = {
                memory: {
                    total: 1024 * 1024 * 1024,
                    used: 512 * 1024 * 1024,
                    free: 512 * 1024 * 1024,
                    processUsage: 256 * 1024 * 1024,
                    heapUsage: 128 * 1024 * 1024
                },
                cpu: {
                    usage: 50,
                    loadAvg: [50, 50, 50],
                    processUsage: 25
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: 512 * 1024 * 1024,
                    cpu: 50
                },
                utilizationPercentages: {
                    memory: 50,
                    cpu: 50
                },
                clusterMetrics: {
                    totalMemory: 1024 * 1024 * 1024,
                    totalCpu: 100,
                    availableMemory: 512 * 1024 * 1024,
                    availableCpu: 50,
                    nodeCount: 1,
                    activeNodes: 1
                }
            };

            resourceManager.updateNodeMetrics(nodeId, nodeMetrics);
            const metrics = await resourceManager.getEnhancedMetrics();

            expect(metrics.clusterMetrics.nodeCount).toBe(2); // Local node + test node
            expect(metrics.clusterMetrics.activeNodes).toBe(2);

            resourceManager.removeNode(nodeId);
            const updatedMetrics = await resourceManager.getEnhancedMetrics();
            expect(updatedMetrics.clusterMetrics.nodeCount).toBe(1); // Only local node
        });

        it('should emit cluster update events', async () => {
            const nodeId = 'test-node';
            const eventSpy = vi.fn();
            
            resourceManager.on('clusterUpdate', eventSpy);

            const nodeMetrics = {
                memory: {
                    total: 1024 * 1024 * 1024,
                    used: 512 * 1024 * 1024,
                    free: 512 * 1024 * 1024,
                    processUsage: 256 * 1024 * 1024,
                    heapUsage: 128 * 1024 * 1024
                },
                cpu: {
                    usage: 50,
                    loadAvg: [50, 50, 50],
                    processUsage: 25
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: 512 * 1024 * 1024,
                    cpu: 50
                },
                utilizationPercentages: {
                    memory: 50,
                    cpu: 50
                },
                clusterMetrics: {
                    totalMemory: 1024 * 1024 * 1024,
                    totalCpu: 100,
                    availableMemory: 512 * 1024 * 1024,
                    availableCpu: 50,
                    nodeCount: 1,
                    activeNodes: 1
                }
            };

            resourceManager.updateNodeMetrics(nodeId, nodeMetrics);
            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
                type: 'nodeUpdate',
                nodeId
            }));

            resourceManager.removeNode(nodeId);
            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
                type: 'nodeRemoval',
                nodeId
            }));
        });
    });

    describe('Resource Alerts', () => {
        it('should emit alerts for critical resource usage', async () => {
            const alertSpy = vi.fn();
            resourceManager.on('alert', alertSpy);

            const criticalRequest = {
                memory: 900 * 1024 * 1024, // 900MB (above warning)
                cpu: 75 // Above warning
            };

            await resourceManager.reserveResources('test-task', criticalRequest);
            
            expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
                type: expect.stringMatching(/memory|cpu/),
                level: 'warning'
            }));
        });
    });
});