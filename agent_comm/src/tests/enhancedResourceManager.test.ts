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
    });
});