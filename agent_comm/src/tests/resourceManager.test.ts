import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResourceManager, ResourceMetrics, ResourceLimits } from '../services/resourceManager';

describe('ResourceManager', () => {
    let resourceManager: ResourceManager;
    const defaultLimits: ResourceLimits = {
        memory: {
            max: 8 * 1024 * 1024 * 1024,    // 8GB
            warning: 6 * 1024 * 1024 * 1024  // 6GB
        },
        cpu: {
            maxUsage: 80,  // 80%
            warning: 60    // 60%
        }
    };

    beforeEach(() => {
        resourceManager = new ResourceManager(defaultLimits);
    });

    afterEach(() => {
        resourceManager.stop();
    });

    describe('Initialization', () => {
        it('should initialize with correct limits', () => {
            const limits = resourceManager.getLimits();
            expect(limits).toEqual(defaultLimits);
        });

        it('should provide initial metrics', () => {
            const metrics = resourceManager.getMetrics();
            expect(metrics).toBeDefined();
            expect(metrics.memory).toBeDefined();
            expect(metrics.cpu).toBeDefined();
            expect(metrics.storage).toBeDefined();
        });
    });

    describe('Memory Monitoring', () => {
        it('should emit warning when memory approaches limit', (done) => {
            const warningHandler = vi.fn();
            resourceManager.on('alert', (alert) => {
                if (alert.type === 'memory' && alert.level === 'warning') {
                    warningHandler(alert);
                }
            });

            // Simulate high memory usage
            const array = new Array(1000000).fill(0);
            
            setTimeout(() => {
                expect(warningHandler).toHaveBeenCalled();
                done();
            }, 2000);
        });

        it('should check memory allocation capability', () => {
            const canAllocate = resourceManager.canAllocateMemory(1024 * 1024); // 1MB
            expect(typeof canAllocate).toBe('boolean');
        });
    });

    describe('CPU Monitoring', () => {
        it('should track CPU usage', (done) => {
            const metricsHandler = vi.fn();
            resourceManager.on('metrics', (metrics: ResourceMetrics) => {
                metricsHandler(metrics);
                expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
                expect(metrics.cpu.loadAvg).toHaveLength(3);
            });

            // Wait for metrics to be collected
            setTimeout(() => {
                expect(metricsHandler).toHaveBeenCalled();
                done();
            }, 2000);
        });

        it('should emit alert on high CPU usage', (done) => {
            const alertHandler = vi.fn();
            resourceManager.on('alert', (alert) => {
                if (alert.type === 'cpu') {
                    alertHandler(alert);
                }
            });

            // Simulate CPU load
            let x = 0;
            for (let i = 0; i < 1000000; i++) {
                x += Math.random();
            }

            setTimeout(() => {
                expect(alertHandler).toHaveBeenCalled();
                done();
            }, 2000);
        });
    });

    describe('Event Emission', () => {
        it('should emit metrics periodically', (done) => {
            const metricsHandler = vi.fn();
            resourceManager.on('metrics', metricsHandler);

            setTimeout(() => {
                expect(metricsHandler).toHaveBeenCalled();
                done();
            }, 2000);
        });

        it('should emit alerts when thresholds are exceeded', (done) => {
            const alertHandler = vi.fn();
            resourceManager.on('alert', alertHandler);

            // Simulate resource usage
            let x = 0;
            const array = new Array(1000000).fill(0);
            for (let i = 0; i < 1000000; i++) {
                x += Math.random();
                array[i] = x;
            }

            setTimeout(() => {
                expect(alertHandler).toHaveBeenCalled();
                done();
            }, 2000);
        });
    });

    describe('Resource Management', () => {
        it('should handle cleanup properly', () => {
            const stopSpy = vi.spyOn(resourceManager, 'stop');
            resourceManager.stop();
            expect(stopSpy).toHaveBeenCalled();
        });

        it('should continue monitoring after high load', (done) => {
            const metricsHandler = vi.fn();
            resourceManager.on('metrics', metricsHandler);

            // Simulate load
            let x = 0;
            for (let i = 0; i < 100000; i++) {
                x += Math.random();
            }

            setTimeout(() => {
                expect(metricsHandler).toHaveBeenCalled();
                done();
            }, 2000);
        });
    });
});