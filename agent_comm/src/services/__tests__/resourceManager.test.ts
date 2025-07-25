import { ResourceManager, ResourceLimits } from '../resourceManager';

describe('ResourceManager', () => {
    let resourceManager: ResourceManager;
    const mockLimits: ResourceLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024, // 768MB
        },
        cpu: {
            maxUsage: 90, // 90%
            warning: 70, // 70%
        }
    };

    beforeEach(() => {
        resourceManager = new ResourceManager(mockLimits);
    });

    afterEach(() => {
        resourceManager.stop();
    });

    describe('getAvailableResources', () => {
        it('should return available resources with correct structure', () => {
            const resources = resourceManager.getAvailableResources();
            
            expect(resources).toHaveProperty('memory');
            expect(resources).toHaveProperty('cpu');
            expect(resources).toHaveProperty('storage');
            expect(resources).toHaveProperty('canAcceptTasks');
            
            expect(typeof resources.memory).toBe('number');
            expect(typeof resources.cpu).toBe('number');
            expect(typeof resources.storage).toBe('number');
            expect(typeof resources.canAcceptTasks).toBe('boolean');
        });

        it('should return valid CPU availability percentage', () => {
            const resources = resourceManager.getAvailableResources();
            
            expect(resources.cpu).toBeGreaterThanOrEqual(0);
            expect(resources.cpu).toBeLessThanOrEqual(100);
        });

        it('should return non-negative memory values', () => {
            const resources = resourceManager.getAvailableResources();
            expect(resources.memory).toBeGreaterThanOrEqual(0);
        });

        it('should correctly determine if tasks can be accepted', () => {
            const resources = resourceManager.getAvailableResources();
            const metrics = resourceManager.getMetrics();
            
            // If CPU and memory usage are below warning thresholds, should accept tasks
            const expectedCanAccept = 
                metrics.memory.free > mockLimits.memory.warning &&
                metrics.cpu.usage < mockLimits.cpu.warning;
            
            expect(resources.canAcceptTasks).toBe(expectedCanAccept);
        });

        it('should reflect system resource changes', () => {
            const initialResources = resourceManager.getAvailableResources();
            
            // Force a metrics update
            resourceManager['checkResources']();
            
            const updatedResources = resourceManager.getAvailableResources();
            
            // Values should be numbers and potentially different
            expect(typeof updatedResources.memory).toBe('number');
            expect(typeof updatedResources.cpu).toBe('number');
            
            // Memory and CPU values should be within reasonable ranges
            expect(updatedResources.memory).toBeGreaterThanOrEqual(0);
            expect(updatedResources.cpu).toBeGreaterThanOrEqual(0);
            expect(updatedResources.cpu).toBeLessThanOrEqual(100);
        });
    });
});