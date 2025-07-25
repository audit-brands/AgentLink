import { ResourceManager, ResourceMetrics as BaseResourceMetrics, ResourceLimits } from './resourceManager';

export interface ResourceMetrics extends BaseResourceMetrics {
    availableResources: {
        memory: number;
        cpu: number;
    };
    utilizationPercentages: {
        memory: number;
        cpu: number;
    };
}

export class EnhancedResourceManager extends ResourceManager {
    constructor(limits: ResourceLimits) {
        super(limits);
    }

    public async getEnhancedMetrics(): Promise<ResourceMetrics> {
        const baseMetrics = this.getMetrics();
        const limits = this.getLimits();

        const availableMemory = limits.memory.max - baseMetrics.memory.processUsage;
        const availableCPU = limits.cpu.maxUsage - baseMetrics.cpu.usage;

        return {
            ...baseMetrics,
            availableResources: {
                memory: Math.max(0, availableMemory),
                cpu: Math.max(0, availableCPU)
            },
            utilizationPercentages: {
                memory: (baseMetrics.memory.processUsage / limits.memory.max) * 100,
                cpu: (baseMetrics.cpu.usage / limits.cpu.maxUsage) * 100
            }
        };
    }

    public async canHandleTask(requiredResources: { memory: number; cpu: number }): Promise<boolean> {
        const metrics = await this.getEnhancedMetrics();
        
        return (
            metrics.availableResources.memory >= requiredResources.memory &&
            metrics.availableResources.cpu >= requiredResources.cpu
        );
    }

    public getResourceUtilization(): { memory: number; cpu: number } {
        const metrics = this.getMetrics();
        const limits = this.getLimits();

        return {
            memory: (metrics.memory.processUsage / limits.memory.max) * 100,
            cpu: (metrics.cpu.usage / limits.cpu.maxUsage) * 100
        };
    }
}