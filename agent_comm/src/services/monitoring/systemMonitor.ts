import { EventEmitter } from 'events';
import { EnhancedResourceManager, ResourceMetrics } from '../enhancedResourceManager';
import os from 'os';

export interface SystemMetrics extends ResourceMetrics {
    timestamp: number;
    system: {
        uptime: number;
        platform: string;
        arch: string;
        nodeVersion: string;
        hostname: string;
    };
    process: {
        pid: number;
        uptime: number;
        memoryUsage: NodeJS.MemoryUsage;
        cpuUsage: NodeJS.CpuUsage;
    };
}

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
        [key: string]: {
            status: 'pass' | 'warn' | 'fail';
            message?: string;
            timestamp: number;
        };
    };
    timestamp: number;
}

export interface AlertConfig {
    memory: {
        warning: number;  // Percentage
        critical: number; // Percentage
    };
    cpu: {
        warning: number;  // Percentage
        critical: number; // Percentage
    };
    healthCheck: {
        interval: number; // Milliseconds
        timeout: number;  // Milliseconds
    };
}

export interface Alert {
    type: 'memory' | 'cpu' | 'health';
    severity: 'warning' | 'critical';
    message: string;
    metrics: Partial<SystemMetrics>;
    timestamp: number;
}

export class SystemMonitor extends EventEmitter {
    private resourceManager: EnhancedResourceManager;
    private config: AlertConfig;
    private healthStatus: HealthStatus;
    private metricsHistory: SystemMetrics[];
    private readonly maxHistoryLength: number = 1000;
    private healthCheckInterval: NodeJS.Timeout | null;

    constructor(resourceManager: EnhancedResourceManager, config: AlertConfig) {
        super();
        this.resourceManager = resourceManager;
        this.config = config;
        this.metricsHistory = [];
        this.healthStatus = {
            status: 'healthy',
            checks: {},
            timestamp: Date.now()
        };
        this.healthCheckInterval = null;

        // Listen to resource manager events
        this.resourceManager.on('metrics', this.handleResourceMetrics.bind(this));
        this.resourceManager.on('alert', this.handleResourceAlert.bind(this));

        // Start health checks
        this.startHealthChecks();
    }

    public async getSystemMetrics(): Promise<SystemMetrics> {
        const resourceMetrics = await this.resourceManager.getEnhancedMetrics();
        
        return {
            ...resourceMetrics,
            timestamp: Date.now(),
            system: {
                uptime: os.uptime(),
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                hostname: os.hostname()
            },
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            }
        };
    }

    public getHealthStatus(): HealthStatus {
        return this.healthStatus;
    }

    public getMetricsHistory(duration?: number): SystemMetrics[] {
        if (!duration) {
            return this.metricsHistory;
        }

        const cutoff = Date.now() - duration;
        return this.metricsHistory.filter(metric => metric.timestamp >= cutoff);
    }

    public start(): void {
        if (this.healthCheckInterval) {
            return;
        }
        this.startHealthChecks();
    }

    public stop(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    private async startHealthChecks(): Promise<void> {
        this.healthCheckInterval = setInterval(
            () => this.performHealthCheck(),
            this.config.healthCheck.interval
        );

        // Perform initial health check
        await this.performHealthCheck();
    }

    private async performHealthCheck(): Promise<void> {
        const metrics = await this.getSystemMetrics();
        const checks: HealthStatus['checks'] = {};

        // Memory check
        const memoryUsage = metrics.utilizationPercentages.memory;
        checks.memory = {
            status: this.getStatusLevel(memoryUsage, this.config.memory.warning, this.config.memory.critical),
            message: `Memory usage at ${memoryUsage.toFixed(1)}%`,
            timestamp: Date.now()
        };

        // CPU check
        const cpuUsage = metrics.cpu.usage;
        checks.cpu = {
            status: this.getStatusLevel(cpuUsage, this.config.cpu.warning, this.config.cpu.critical),
            message: `CPU usage at ${cpuUsage.toFixed(1)}%`,
            timestamp: Date.now()
        };

        // System uptime check
        checks.uptime = {
            status: 'pass',
            message: `System uptime: ${(os.uptime() / 3600).toFixed(1)} hours`,
            timestamp: Date.now()
        };

        // Update health status
        const criticalChecks = Object.values(checks).filter(check => check.status === 'fail').length;
        const warningChecks = Object.values(checks).filter(check => check.status === 'warn').length;

        this.healthStatus = {
            status: criticalChecks > 0 ? 'unhealthy' :
                    warningChecks > 0 ? 'degraded' : 'healthy',
            checks,
            timestamp: Date.now()
        };

        // Emit health status update
        this.emit('health', this.healthStatus);

        // Store metrics history
        this.metricsHistory.push(metrics);
        if (this.metricsHistory.length > this.maxHistoryLength) {
            this.metricsHistory.shift();
        }
    }

    private handleResourceMetrics(event: { type: string; metrics: ResourceMetrics; timestamp: Date }): void {
        const systemMetrics: SystemMetrics = {
            ...event.metrics,
            timestamp: event.timestamp.getTime(),
            system: {
                uptime: os.uptime(),
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                hostname: os.hostname()
            },
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            }
        };

        this.emit('metrics', systemMetrics);
    }

    private handleResourceAlert(alert: any): void {
        const systemAlert: Alert = {
            type: alert.type,
            severity: alert.level === 'critical' ? 'critical' : 'warning',
            message: alert.message,
            metrics: alert.metrics || {},
            timestamp: alert.timestamp.getTime()
        };

        this.emit('alert', systemAlert);
    }

    private getStatusLevel(value: number, warningThreshold: number, criticalThreshold: number): 'pass' | 'warn' | 'fail' {
        if (value >= criticalThreshold) {
            return 'fail';
        }
        if (value >= warningThreshold) {
            return 'warn';
        }
        return 'pass';
    }
}