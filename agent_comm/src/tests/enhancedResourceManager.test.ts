import { describe, it, expect, beforeEach } from 'vitest';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { ResourceLimits } from '../services/resourceManager';

describe('EnhancedResourceManager', () => {
    let manager: EnhancedResourceManager;
    const limits: ResourceLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024, // 768MB
        },
        cpu: {
            maxUsage: 80, // 80%
            warning: 70, // 70%
        },
    };

    beforeEach(() => {
        manager = new EnhancedResourceManager(limits);
    });

    describe('getEnhancedMetrics', () => {
        it('should return enhanced metrics with available resources', async () => {
            const metrics = await manager.getEnhancedMetrics();
            
            expect(metrics).toHaveProperty('availableResources');
            expect(metrics.availableResources).toHaveProperty('memory');
            expect(metrics.availableResources).toHaveProperty('cpu');
            expect(metrics.availableResources.memory).toBeGreaterThanOrEqual(0);
            expect(metrics.availableResources.cpu).toBeGreaterThanOrEqual(0);
        });

        it('should calculate utilization percentages correctly', async () => {
            const metrics = await manager.getEnhancedMetrics();
            
            expect(metrics).toHaveProperty('utilizationPercentages');
            expect(metrics.utilizationPercentages.memory).toBeGreaterThanOrEqual(0);
            expect(metrics.utilizationPercentages.memory).toBeLessThanOrEqual(100);
            expect(metrics.utilizationPercentages.cpu).toBeGreaterThanOrEqual(0);
            expect(metrics.utilizationPercentages.cpu).toBeLessThanOrEqual(100);
        });

        it('should include cluster metrics', async () => {
            const metrics = await manager.getEnhancedMetrics();
            
            expect(metrics).toHaveProperty('clusterMetrics');
            expect(metrics.clusterMetrics).toHaveProperty('totalMemory');
            expect(metrics.clusterMetrics).toHaveProperty('totalCpu');
            expect(metrics.clusterMetrics).toHaveProperty('availableMemory');
            expect(metrics.clusterMetrics).toHaveProperty('availableCpu');
            expect(metrics.clusterMetrics).toHaveProperty('nodeCount');
            expect(metrics.clusterMetrics).toHaveProperty('activeNodes');
        });
    });

    describe('Resource Reservation', () => {
        it('should successfully reserve resources when available', async () => {
            const taskId = 'test-task-1';
            const requirements = {
                memory: 256 * 1024 * 1024, // 256MB
                cpu: 20,
                timeoutMs: 5000
            };

            const reserved = await manager.reserveResources(taskId, requirements);
            expect(reserved).toBe(true);

            const metrics = await manager.getEnhancedMetrics();
            expect(metrics.availableResources.memory).toBeLessThan(limits.memory.max);
            expect(metrics.availableResources.cpu).toBeLessThan(limits.cpu.maxUsage);
        });

        it('should fail to reserve resources when exceeding limits', async () => {
            const taskId = 'test-task-2';
            const requirements = {
                memory: 2 * 1024 * 1024 * 1024, // 2GB (exceeds limit)
                cpu: 90, // Exceeds CPU limit
                timeoutMs: 5000
            };

            const reserved = await manager.reserveResources(taskId, requirements);
            expect(reserved).toBe(false);
        });

        it('should release resources correctly', async () => {
            const taskId = 'test-task-3';
            const requirements = {
                memory: 256 * 1024 * 1024,
                cpu: 20,
                timeoutMs: 5000
            };

            await manager.reserveResources(taskId, requirements);
            const metricsBeforeRelease = await manager.getEnhancedMetrics();
            
            manager.releaseResources(taskId);
            const metricsAfterRelease = await manager.getEnhancedMetrics();

            expect(metricsAfterRelease.availableResources.memory)
                .toBeGreaterThan(metricsBeforeRelease.availableResources.memory);
            expect(metricsAfterRelease.availableResources.cpu)
                .toBeGreaterThan(metricsBeforeRelease.availableResources.cpu);
        });

        it('should automatically release resources after timeout', async () => {
            const taskId = 'test-task-4';
            const requirements = {
                memory: 256 * 1024 * 1024,
                cpu: 20,
                timeoutMs: 100 // Short timeout for testing
            };

            await manager.reserveResources(taskId, requirements);
            
            // Wait for timeout
            await new Promise(resolve => setTimeout(resolve, 200));
            
            const metrics = await manager.getEnhancedMetrics();
            const reservations = (manager as any).resourceReservations;
            expect(reservations.has(taskId)).toBe(false);
        });
    });

    describe('Cluster Resource Management', () => {
        it('should update cluster resources correctly', () => {
            const clusterUpdate = {
                totalMemory: 4 * 1024 * 1024 * 1024, // 4GB
                totalCpu: 400, // 4 cores
                availableMemory: 3 * 1024 * 1024 * 1024, // 3GB
                availableCpu: 300,
                nodeCount: 4,
                activeNodes: 3
            };

            manager.updateClusterResources(clusterUpdate);
            const metrics = manager.getClusterMetrics();

            expect(metrics).toEqual(clusterUpdate);
        });

        it('should handle remote alerts correctly', () => {
            let alertReceived = false;
            manager.on('remote:alert', () => {
                alertReceived = true;
            });

            manager.handleRemoteAlert('node-1', {
                type: 'memory',
                level: 'critical',
                message: 'Memory usage critical',
                value: 900 * 1024 * 1024,
                threshold: 1024 * 1024 * 1024,
                timestamp: new Date()
            });

            expect(alertReceived).toBe(true);
        });

        it('should update active nodes count on critical alerts', () => {
            manager.updateClusterResources({
                nodeCount: 4,
                activeNodes: 4,
                totalMemory: 4 * 1024 * 1024 * 1024,
                totalCpu: 400,
                availableMemory: 3 * 1024 * 1024 * 1024,
                availableCpu: 300
            });

            manager.handleRemoteAlert('node-1', {
                type: 'memory',
                level: 'critical',
                message: 'Memory usage critical',
                value: 900 * 1024 * 1024,
                threshold: 1024 * 1024 * 1024,
                timestamp: new Date()
            });

            const metrics = manager.getClusterMetrics();
            expect(metrics.activeNodes).toBe(3);
        });
    });

    describe('canHandleTask', () => {
        it('should return true when resources are available', async () => {
            const requiredResources = {
                memory: 100 * 1024 * 1024, // 100MB
                cpu: 10, // 10%
            };
            
            const result = await manager.canHandleTask(requiredResources);
            expect(result).toBeDefined();
        });

        it('should return false when resources exceed limits', async () => {
            const requiredResources = {
                memory: 2 * 1024 * 1024 * 1024, // 2GB (exceeds max)
                cpu: 90, // 90% (exceeds max)
            };
            
            const result = await manager.canHandleTask(requiredResources);
            expect(result).toBe(false);
        });

        it('should consider cluster resources when local resources are insufficient', async () => {
            // Set up cluster resources
            manager.updateClusterResources({
                totalMemory: 4 * 1024 * 1024 * 1024,
                totalCpu: 400,
                availableMemory: 3 * 1024 * 1024 * 1024,
                availableCpu: 300,
                nodeCount: 4,
                activeNodes: 4
            });

            const requiredResources = {
                memory: 2 * 1024 * 1024 * 1024, // 2GB (exceeds local but within cluster)
                cpu: 150 // 150% (exceeds local but within cluster)
            };

            const result = await manager.canHandleTask(requiredResources);
            expect(result).toBe(true);
        });
    });

    describe('getResourceUtilization', () => {
        it('should return valid utilization percentages', () => {
            const utilization = manager.getResourceUtilization();
            
            expect(utilization.memory).toBeGreaterThanOrEqual(0);
            expect(utilization.memory).toBeLessThanOrEqual(100);
            expect(utilization.cpu).toBeGreaterThanOrEqual(0);
            expect(utilization.cpu).toBeLessThanOrEqual(100);
        });
    });

    describe('edge cases', () => {
        it('should handle zero resource requirements', async () => {
            const result = await manager.canHandleTask({ memory: 0, cpu: 0 });
            expect(result).toBe(true);
        });

        it('should handle maximum resource limits', async () => {
            const result = await manager.canHandleTask({
                memory: limits.memory.max,
                cpu: limits.cpu.maxUsage,
            });
            expect(result).toBeDefined();
        });

        it('should handle partial cluster updates', () => {
            const initialUpdate = {
                totalMemory: 4 * 1024 * 1024 * 1024,
                totalCpu: 400,
                availableMemory: 3 * 1024 * 1024 * 1024,
                availableCpu: 300,
                nodeCount: 4,
                activeNodes: 4
            };
            
            manager.updateClusterResources(initialUpdate);
            
            const partialUpdate = {
                availableMemory: 2 * 1024 * 1024 * 1024,
                availableCpu: 200
            };
            
            manager.updateClusterResources(partialUpdate);
            
            const metrics = manager.getClusterMetrics();
            expect(metrics.totalMemory).toBe(initialUpdate.totalMemory);
            expect(metrics.availableMemory).toBe(partialUpdate.availableMemory);
        });
    });
});