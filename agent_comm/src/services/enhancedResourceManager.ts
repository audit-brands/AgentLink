import { ResourceManager, ResourceMetrics as BaseResourceMetrics, ResourceLimits, ResourceAlert } from './resourceManager';

export interface ResourceMetrics extends BaseResourceMetrics {
    availableResources: {
        memory: number;
        cpu: number;
    };
    utilizationPercentages: {
        memory: number;
        cpu: number;
    };
    clusterMetrics?: ClusterResources;
}

export interface ClusterResources {
    totalMemory: number;
    totalCpu: number;
    availableMemory: number;
    availableCpu: number;
    nodeCount: number;
    activeNodes: number;
}

export interface ResourceAllocationRequest {
    memory: number;
    cpu: number;
    priority?: number;
    timeoutMs?: number;
}

export class EnhancedResourceManager extends ResourceManager {
    private clusterResources: ClusterResources;
    private resourceReservations: Map<string, ResourceAllocationRequest>;
    private readonly defaultReservationTimeout = 30000; // 30 seconds

    constructor(limits: ResourceLimits) {
        super(limits);
        this.clusterResources = {
            totalMemory: 0,
            totalCpu: 0,
            availableMemory: 0,
            availableCpu: 0,
            nodeCount: 0,
            activeNodes: 0
        };
        this.resourceReservations = new Map();

        // Cleanup expired reservations periodically
        setInterval(() => this.cleanupExpiredReservations(), 10000);
    }

    public async getEnhancedMetrics(): Promise<ResourceMetrics> {
        const baseMetrics = this.getMetrics();
        const limits = this.getLimits();

        // Calculate available resources considering reservations
        const totalReservedMemory = Array.from(this.resourceReservations.values())
            .reduce((total, res) => total + res.memory, 0);
        const totalReservedCpu = Array.from(this.resourceReservations.values())
            .reduce((total, res) => total + res.cpu, 0);

        const availableMemory = limits.memory.max - baseMetrics.memory.processUsage - totalReservedMemory;
        const availableCPU = limits.cpu.maxUsage - baseMetrics.cpu.usage - totalReservedCpu;

        return {
            ...baseMetrics,
            availableResources: {
                memory: Math.max(0, availableMemory),
                cpu: Math.max(0, availableCPU)
            },
            utilizationPercentages: {
                memory: (baseMetrics.memory.processUsage / limits.memory.max) * 100,
                cpu: (baseMetrics.cpu.usage / limits.cpu.maxUsage) * 100
            },
            clusterMetrics: this.clusterResources
        };
    }

    public async canHandleTask(requiredResources: ResourceAllocationRequest): Promise<boolean> {
        const metrics = await this.getEnhancedMetrics();
        
        // Check both local and cluster-wide resources
        const localAvailable = 
            metrics.availableResources.memory >= requiredResources.memory &&
            metrics.availableResources.cpu >= requiredResources.cpu;

        const clusterAvailable = 
            metrics.clusterMetrics &&
            metrics.clusterMetrics.availableMemory >= requiredResources.memory &&
            metrics.clusterMetrics.availableCpu >= requiredResources.cpu;

        return localAvailable || (clusterAvailable || false);
    }

    public getResourceUtilization(): { memory: number; cpu: number } {
        const metrics = this.getMetrics();
        const limits = this.getLimits();

        return {
            memory: (metrics.memory.processUsage / limits.memory.max) * 100,
            cpu: (metrics.cpu.usage / limits.cpu.maxUsage) * 100
        };
    }

    /**
     * Updates cluster-wide resource information
     */
    public updateClusterResources(resources: Partial<ClusterResources>): void {
        this.clusterResources = {
            ...this.clusterResources,
            ...resources
        };
        this.emit('cluster:resources:updated', this.clusterResources);
    }

    /**
     * Reserves resources for a task
     */
    public async reserveResources(
        taskId: string,
        requirements: ResourceAllocationRequest
    ): Promise<boolean> {
        if (!await this.canHandleTask(requirements)) {
            return false;
        }

        const timeout = requirements.timeoutMs || this.defaultReservationTimeout;
        this.resourceReservations.set(taskId, requirements);

        // Set timeout to automatically release reservation
        setTimeout(() => {
            this.releaseResources(taskId);
        }, timeout);

        this.emit('resources:reserved', {
            taskId,
            requirements
        });

        return true;
    }

    /**
     * Releases reserved resources
     */
    public releaseResources(taskId: string): void {
        const reservation = this.resourceReservations.get(taskId);
        if (reservation) {
            this.resourceReservations.delete(taskId);
            this.emit('resources:released', {
                taskId,
                resources: reservation
            });
        }
    }

    /**
     * Gets current cluster metrics
     */
    public getClusterMetrics(): ClusterResources {
        return this.clusterResources;
    }

    /**
     * Handles resource alerts from other nodes
     */
    public handleRemoteAlert(nodeId: string, alert: ResourceAlert): void {
        this.emit('remote:alert', {
            nodeId,
            alert
        });

        if (alert.level === 'critical') {
            this.updateClusterResources({
                activeNodes: Math.max(0, this.clusterResources.activeNodes - 1)
            });
        }
    }

    private cleanupExpiredReservations(): void {
        for (const [taskId] of this.resourceReservations.entries()) {
            this.releaseResources(taskId);
        }
    }

    protected override checkResources(): void {
        super.checkResources();
        
        // Add cluster-aware resource checks
        const metrics = this.getMetrics();
        const totalReservedMemory = Array.from(this.resourceReservations.values())
            .reduce((total, res) => total + res.memory, 0);
        const totalReservedCpu = Array.from(this.resourceReservations.values())
            .reduce((total, res) => total + res.cpu, 0);

        // Update cluster resources with local information
        this.updateClusterResources({
            availableMemory: metrics.memory.free - totalReservedMemory,
            availableCpu: 100 - metrics.cpu.usage - totalReservedCpu
        });
    }
}