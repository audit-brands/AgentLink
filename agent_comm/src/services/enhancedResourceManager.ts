import { EventEmitter } from 'events';
import os from 'os';

export interface ResourceLimits {
    memory: {
        max: number;
        warning: number;
    };
    cpu: {
        maxUsage: number;
        warning: number;
    };
}

export interface ResourceMetrics {
    memory: {
        total: number;
        used: number;
        free: number;
        processUsage: number;
        heapUsage: number;
    };
    cpu: {
        usage: number;
        loadAvg: number[];
        processUsage: number;
    };
    storage: {
        used: number;
        free: number;
    };
    availableResources: {
        memory: number;
        cpu: number;
    };
    utilizationPercentages: {
        memory: number;
        cpu: number;
    };
    clusterMetrics: {
        totalMemory: number;
        totalCpu: number;
        availableMemory: number;
        availableCpu: number;
        nodeCount: number;
        activeNodes: number;
    };
}

export interface ResourceRequest {
    memory: number;
    cpu: number;
    timeoutMs?: number;
}

export class EnhancedResourceManager extends EventEmitter {
    public readonly limits: ResourceLimits;
    private reservedResources: Map<string, ResourceRequest>;
    private metricsInterval: NodeJS.Timer | null;
    private clusterNodes: Map<string, ResourceMetrics>;
    private lastCpuUsage: { user: number; system: number } | null;
    private lastCpuTime: number;
    private readonly totalMemory: number;
    private readonly totalCpu: number;

    constructor(limits: ResourceLimits) {
        super();
        this.limits = limits;
        this.reservedResources = new Map();
        this.clusterNodes = new Map();
        this.metricsInterval = null;
        this.lastCpuUsage = null;
        this.lastCpuTime = Date.now();
        this.totalMemory = os.totalmem();
        this.totalCpu = 100; // 100% CPU
        
        // Start metrics monitoring
        this.start();
    }

    /**
     * Start resource monitoring
     */
    public start(): void {
        if (!this.metricsInterval) {
            this.metricsInterval = setInterval(() => this.updateMetrics(), 1000);
        }
    }

    /**
     * Stop resource monitoring
     */
    public stop(): void {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
    }

    /**
     * Get current resource metrics
     */
    public async getEnhancedMetrics(): Promise<ResourceMetrics> {
        const metrics = await this.collectLocalMetrics();
        const clusterMetrics = this.aggregateClusterMetrics();
        
        return {
            ...metrics,
            clusterMetrics
        };
    }

    /**
     * Check if a task can be handled with current resources
     */
    public async canHandleTask(request: ResourceRequest): Promise<boolean> {
        const metrics = await this.getEnhancedMetrics();
        const { availableResources } = metrics;

        // Check if we have enough free resources
        const hasEnoughMemory = availableResources.memory >= request.memory;
        const hasEnoughCpu = availableResources.cpu >= request.cpu;

        // Check if allocation would exceed limits
        const totalReservedMemory = Array.from(this.reservedResources.values())
            .reduce((sum, req) => sum + req.memory, 0);
        const totalReservedCpu = Array.from(this.reservedResources.values())
            .reduce((sum, req) => sum + req.cpu, 0);

        const wouldExceedMemoryLimit = 
            (totalReservedMemory + request.memory) / this.totalMemory * 100 > this.limits.memory.max;
        const wouldExceedCpuLimit = 
            totalReservedCpu + request.cpu > this.limits.cpu.maxUsage;

        return hasEnoughMemory && hasEnoughCpu && !wouldExceedMemoryLimit && !wouldExceedCpuLimit;
    }

    /**
     * Reserve resources for a task
     */
    public async reserveResources(
        taskId: string,
        request: ResourceRequest
    ): Promise<boolean> {
        if (await this.canHandleTask(request)) {
            this.reservedResources.set(taskId, request);

            // Check if this reservation puts us over warning thresholds
            const totalReservedMemory = Array.from(this.reservedResources.values())
                .reduce((sum, req) => sum + req.memory, 0);
            const totalReservedCpu = Array.from(this.reservedResources.values())
                .reduce((sum, req) => sum + req.cpu, 0);

            const memoryPercentage = (totalReservedMemory / this.totalMemory) * 100;
            if (memoryPercentage >= this.limits.memory.warning) {
                this.emit('alert', {
                    type: 'memory',
                    level: memoryPercentage >= this.limits.memory.max ? 'critical' : 'warning',
                    message: `Memory usage at ${memoryPercentage.toFixed(1)}%`,
                    value: totalReservedMemory,
                    threshold: this.limits.memory.warning,
                    timestamp: new Date()
                });
            }

            if (totalReservedCpu >= this.limits.cpu.warning) {
                this.emit('alert', {
                    type: 'cpu',
                    level: totalReservedCpu >= this.limits.cpu.maxUsage ? 'critical' : 'warning',
                    message: `CPU usage at ${totalReservedCpu.toFixed(1)}%`,
                    value: totalReservedCpu,
                    threshold: this.limits.cpu.warning,
                    timestamp: new Date()
                });
            }

            return true;
        }
        return false;
    }

    /**
     * Release reserved resources
     */
    public releaseResources(taskId: string): void {
        this.reservedResources.delete(taskId);
    }

    /**
     * Get current resource utilization
     */
    public getResourceUtilization(): { memory: number; cpu: number } {
        const totalReservedMemory = Array.from(this.reservedResources.values())
            .reduce((sum, req) => sum + req.memory, 0);
        
        const totalReservedCpu = Array.from(this.reservedResources.values())
            .reduce((sum, req) => sum + req.cpu, 0);

        return {
            memory: (totalReservedMemory / this.totalMemory) * 100,
            cpu: totalReservedCpu
        };
    }

    /**
     * Update node metrics in cluster
     */
    public updateNodeMetrics(nodeId: string, metrics: ResourceMetrics): void {
        this.clusterNodes.set(nodeId, metrics);
        this.emit('clusterUpdate', {
            type: 'nodeUpdate',
            nodeId,
            metrics,
            timestamp: new Date()
        });
    }

    /**
     * Remove node from cluster
     */
    public removeNode(nodeId: string): void {
        this.clusterNodes.delete(nodeId);
        this.emit('clusterUpdate', {
            type: 'nodeRemoval',
            nodeId,
            timestamp: new Date()
        });
    }

    private async collectLocalMetrics(): Promise<ResourceMetrics> {
        const totalMemory = this.totalMemory;
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const cpuUsage = await this.getCpuUsage();
        const processMemory = process.memoryUsage();

        // Calculate available resources considering reservations
        const totalReservedMemory = Array.from(this.reservedResources.values())
            .reduce((sum, req) => sum + req.memory, 0);
        const totalReservedCpu = Array.from(this.reservedResources.values())
            .reduce((sum, req) => sum + req.cpu, 0);

        const metrics: ResourceMetrics = {
            memory: {
                total: totalMemory,
                used: usedMemory,
                free: freeMemory,
                processUsage: processMemory.rss,
                heapUsage: processMemory.heapUsed
            },
            cpu: {
                usage: cpuUsage,
                loadAvg: os.loadavg(),
                processUsage: process.cpuUsage().user / 1000000
            },
            storage: {
                used: 0, // Implement storage metrics if needed
                free: 1000
            },
            availableResources: {
                memory: Math.max(0, freeMemory - totalReservedMemory),
                cpu: Math.max(0, this.totalCpu - cpuUsage - totalReservedCpu)
            },
            utilizationPercentages: {
                memory: (usedMemory / totalMemory) * 100,
                cpu: cpuUsage
            },
            clusterMetrics: this.aggregateClusterMetrics()
        };

        // Check for resource alerts
        this.checkResourceAlerts(metrics);

        return metrics;
    }

    private async getCpuUsage(): Promise<number> {
        const cpus = os.cpus();
        const currentCpuUsage = process.cpuUsage();
        const currentTime = Date.now();

        if (!this.lastCpuUsage) {
            this.lastCpuUsage = currentCpuUsage;
            this.lastCpuTime = currentTime;
            return 0;
        }

        const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
        const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
        const timeDiff = currentTime - this.lastCpuTime;

        this.lastCpuUsage = currentCpuUsage;
        this.lastCpuTime = currentTime;

        const totalCpu = cpus.reduce((acc, cpu) => {
            const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
            return acc + (cpu.times.user + cpu.times.nice + cpu.times.sys) / total * 100;
        }, 0);
        
        // Combine process-specific and system-wide metrics
        const processCpuUsage = (userDiff + systemDiff) / (timeDiff * 1000) * 100;
        return Math.min(100, (totalCpu / cpus.length + processCpuUsage) / 2);
    }

    private aggregateClusterMetrics(): ResourceMetrics['clusterMetrics'] {
        let totalMemory = this.totalMemory;
        let totalCpu = this.totalCpu;
        let availableMemory = os.freemem();
        let availableCpu = this.totalCpu;
        let activeNodes = 1; // Local node is always active

        // Add remote node metrics
        for (const metrics of this.clusterNodes.values()) {
            totalMemory += metrics.memory.total;
            totalCpu += 100; // Each node has 100% CPU
            availableMemory += metrics.availableResources.memory;
            availableCpu += metrics.availableResources.cpu;
            if (metrics.cpu.usage < this.limits.cpu.maxUsage) {
                activeNodes++;
            }
        }

        return {
            totalMemory,
            totalCpu,
            availableMemory,
            availableCpu,
            nodeCount: this.clusterNodes.size + 1, // Include local node
            activeNodes
        };
    }

    private checkResourceAlerts(metrics: ResourceMetrics): void {
        // Memory alerts
        if (metrics.utilizationPercentages.memory >= this.limits.memory.max) {
            this.emit('alert', {
                type: 'memory',
                level: 'critical',
                message: 'Memory usage exceeded maximum limit',
                value: metrics.memory.used,
                threshold: this.limits.memory.max,
                timestamp: new Date()
            });
        } else if (metrics.utilizationPercentages.memory >= this.limits.memory.warning) {
            this.emit('alert', {
                type: 'memory',
                level: 'warning',
                message: 'Memory usage approaching maximum limit',
                value: metrics.memory.used,
                threshold: this.limits.memory.warning,
                timestamp: new Date()
            });
        }

        // CPU alerts
        if (metrics.cpu.usage >= this.limits.cpu.maxUsage) {
            this.emit('alert', {
                type: 'cpu',
                level: 'critical',
                message: 'CPU usage exceeded maximum limit',
                value: metrics.cpu.usage,
                threshold: this.limits.cpu.maxUsage,
                timestamp: new Date()
            });
        } else if (metrics.cpu.usage >= this.limits.cpu.warning) {
            this.emit('alert', {
                type: 'cpu',
                level: 'warning',
                message: 'CPU usage approaching maximum limit',
                value: metrics.cpu.usage,
                threshold: this.limits.cpu.warning,
                timestamp: new Date()
            });
        }
    }

    private async updateMetrics(): Promise<void> {
        const metrics = await this.collectLocalMetrics();
        this.emit('metrics', {
            type: 'update',
            metrics,
            timestamp: new Date()
        });
    }
}