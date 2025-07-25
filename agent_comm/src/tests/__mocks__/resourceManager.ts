import { EventEmitter } from 'events';
import { vi } from 'vitest';
import { ResourceLimits } from '../../services/resourceManager';

export class ResourceManager extends EventEmitter {
    constructor(private limits: ResourceLimits) {
        super();
    }

    start = vi.fn(() => {
        process.nextTick(() => this.emit('ready'));
        return this;
    });

    stop = vi.fn(() => {
        process.nextTick(() => this.emit('stopped'));
        return this;
    });

    getMetrics = vi.fn(() => ({
        memory: {
            total: 8 * 1024 * 1024 * 1024,
            free: 4 * 1024 * 1024 * 1024,
            processUsage: 2 * 1024 * 1024 * 1024
        },
        cpu: {
            usage: 30
        }
    }));
}