import { EventEmitter } from 'events';
import os from 'os';
import v8 from 'v8';

export interface AvailableResources {
    memory: number;      // Available memory in bytes
    cpu: number;         // Available CPU percentage
    storage: number;     // Available storage in bytes
    canAcceptTasks: boolean;  // Whether new tasks can be accepted
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
}

export interface ResourceLimits {
    memory: {
        max: number;        // Maximum memory usage in bytes
        warning: number;    // Warning threshold in bytes
    };
    cpu: {
        maxUsage: number;  // Maximum CPU usage percentage
        warning: number;   // Warning threshold percentage
    };
}

export interface ResourceAlert {
    type: 'memory' | 'cpu' | 'storage';
    level: 'warning' | 'critical';
    message: string;
    value: number;
    threshold: number;
    timestamp: Date;
}

export class ResourceManager extends EventEmitter {
    private readonly limits: ResourceLimits;
    private metrics: ResourceMetrics;
    private lastCPUUsage: NodeJS.CpuUsage;
    private lastCheck: number;
    private checkInterval: NodeJS.Timer;

    constructor(limits: ResourceLimits) {
        super();
        this.limits = limits;
        this.lastCPUUsage = process.cpuUsage();
        this.lastCheck = Date.now();
        this.metrics = this.initializeMetrics();

        // Start monitoring
        this.checkInterval = setInterval(() => this.checkResources(), 1000);
    }

    /**
     * Get current resource metrics
     */
    public getMetrics(): ResourceMetrics {
        return this.metrics;
    }

    /**
     * Get configured resource limits
     */
    public getLimits(): ResourceLimits {
        return this.limits;
    }

    /**
     * Check if there's enough memory available for a new task
     */
    public canAllocateMemory(requiredBytes: number): boolean {
        const currentUsage = this.metrics.memory.processUsage;
        return (currentUsage + requiredBytes) < this.limits.memory.max;
    }

    /**
     * Stop resource monitoring
     */
    public stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }

    /**
     * Gets the current available resources for task execution
     * @returns {AvailableResources} Current available resource metrics
     */
    public getAvailableResources(): AvailableResources {
        const metrics = this.getMetrics();
        const limits = this.getLimits();
        
        // Calculate available resources
        const availableMemory = metrics.memory.free;
        const availableCpu = Math.max(0, 100 - metrics.cpu.usage);
        
        // Determine if we can accept new tasks based on thresholds
        const memoryOk = availableMemory > limits.memory.warning;
        const cpuOk = metrics.cpu.usage < limits.cpu.warning;
        const canAcceptTasks = memoryOk && cpuOk;

        return {
            memory: availableMemory,
            cpu: availableCpu,
            storage: metrics.storage.free,
            canAcceptTasks
        };
    }
    private initializeMetrics(): ResourceMetrics {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const heapStats = v8.getHeapStatistics();

        return {
            memory: {
                total: totalMem,
                used: totalMem - freeMem,
                free: freeMem,
                processUsage: process.memoryUsage().heapUsed,
                heapUsage: heapStats.used_heap_size
            },
            cpu: {
                usage: 0,
                loadAvg: os.loadavg(),
                processUsage: 0
            },
            storage: {
                used: 0,
                free: os.freemem() // Using system memory as fallback
            }
        };
    }

    private checkResources(): void {
        const currentMetrics = this.updateMetrics();
        this.checkMemoryLimits(currentMetrics.memory);
        this.checkCPULimits(currentMetrics.cpu);
        this.emit('metrics', currentMetrics);
    }

    private updateMetrics(): ResourceMetrics {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const heapStats = v8.getHeapStatistics();
        const currentCPU = process.cpuUsage(this.lastCPUUsage);
        const now = Date.now();
        const timeDiff = now - this.lastCheck;

        // Calculate CPU usage percentage
        const totalCPUUsage = (currentCPU.user + currentCPU.system) / 1000; // Convert to ms
        const cpuUsagePercent = (totalCPUUsage / timeDiff) * 100;

        this.lastCPUUsage = process.cpuUsage();
        this.lastCheck = now;

        this.metrics = {
            memory: {
                total: totalMem,
                used: totalMem - freeMem,
                free: freeMem,
                processUsage: process.memoryUsage().heapUsed,
                heapUsage: heapStats.used_heap_size
            },
            cpu: {
                usage: cpuUsagePercent,
                loadAvg: os.loadavg(),
                processUsage: cpuUsagePercent
            },
            storage: {
                used: 0,  // Will be implemented with actual storage monitoring
                free: 0
            }
        };

        return this.metrics;
    }

    private checkMemoryLimits(memory: ResourceMetrics['memory']): void {
        const usagePercent = (memory.processUsage / this.limits.memory.max) * 100;

        if (memory.processUsage >= this.limits.memory.max) {
            this.emitAlert({
                type: 'memory',
                level: 'critical',
                message: `Memory usage exceeded maximum limit: ${usagePercent.toFixed(1)}%`,
                value: memory.processUsage,
                threshold: this.limits.memory.max,
                timestamp: new Date()
            });
        } else if (memory.processUsage >= this.limits.memory.warning) {
            this.emitAlert({
                type: 'memory',
                level: 'warning',
                message: `Memory usage approaching limit: ${usagePercent.toFixed(1)}%`,
                value: memory.processUsage,
                threshold: this.limits.memory.warning,
                timestamp: new Date()
            });
        }
    }

    private checkCPULimits(cpu: ResourceMetrics['cpu']): void {
        if (cpu.usage >= this.limits.cpu.maxUsage) {
            this.emitAlert({
                type: 'cpu',
                level: 'critical',
                message: `CPU usage exceeded maximum limit: ${cpu.usage.toFixed(1)}%`,
                value: cpu.usage,
                threshold: this.limits.cpu.maxUsage,
                timestamp: new Date()
            });
        } else if (cpu.usage >= this.limits.cpu.warning) {
            this.emitAlert({
                type: 'cpu',
                level: 'warning',
                message: `CPU usage approaching limit: ${cpu.usage.toFixed(1)}%`,
                value: cpu.usage,
                threshold: this.limits.cpu.warning,
                timestamp: new Date()
            });
        }
    }

    private emitAlert(alert: ResourceAlert): void {
        this.emit('alert', alert);
    }
}