import { EventEmitter } from 'events';

interface ServiceOptions {
    environment?: string;
    capabilities?: string[];
}

interface ServiceUpdate {
    addresses: string[];
    port: number;
    txt: {
        environment?: string;
        capabilities?: string;
    };
    name: string;
}

export class Advertisement extends EventEmitter {
    private name: string;
    private port: number;
    private options: ServiceOptions;
    private isRunning: boolean = false;

    constructor(name: string, port: number, options: ServiceOptions) {
        super();
        this.name = name;
        this.port = port;
        this.options = options;
    }

    start(): void {
        if (this.isRunning) {
            this.emit('error', new Error('Advertisement already running'));
            return;
        }

        this.isRunning = true;
        process.nextTick(() => {
            this.emit('ready', {
                name: this.name,
                port: this.port,
                options: this.options
            });
            this.emit('started');
        });
    }

    stop(): void {
        if (!this.isRunning) {
            this.emit('error', new Error('Advertisement not running'));
            return;
        }

        this.isRunning = false;
        process.nextTick(() => {
            this.emit('stopped');
        });
    }

    isActive(): boolean {
        return this.isRunning;
    }
}

export class Browser extends EventEmitter {
    private serviceName: string;
    private isRunning: boolean = false;
    private discoveredServices: Map<string, ServiceUpdate> = new Map();

    constructor(serviceName: string) {
        super();
        this.serviceName = serviceName;
    }

    discover(): void {
        if (this.isRunning) {
            this.emit('error', new Error('Browser already running'));
            return;
        }

        this.isRunning = true;
        process.nextTick(() => {
            this.emit('ready');

            // Simulate initial service discovery
            const defaultService: ServiceUpdate = {
                addresses: ['127.0.0.1'],
                port: 8080,
                txt: {
                    environment: 'test',
                    capabilities: 'compute,storage'
                },
                name: this.serviceName
            };

            this.discoveredServices.set(defaultService.name, defaultService);
            this.emit('update', defaultService);
        });
    }

    start(): void {
        this.discover();
    }

    stop(): void {
        if (!this.isRunning) {
            this.emit('error', new Error('Browser not running'));
            return;
        }

        this.isRunning = false;
        process.nextTick(() => {
            this.discoveredServices.clear();
            this.emit('stopped');
        });
    }

    simulateServiceFound(service: ServiceUpdate): void {
        if (!this.isRunning) {
            throw new Error('Browser not running');
        }

        process.nextTick(() => {
            this.discoveredServices.set(service.name, service);
            this.emit('update', service);
        });
    }

    simulateServiceLost(serviceName: string): void {
        if (!this.isRunning) {
            throw new Error('Browser not running');
        }

        process.nextTick(() => {
            if (this.discoveredServices.has(serviceName)) {
                this.discoveredServices.delete(serviceName);
                this.emit('removed', { name: serviceName });
            }
        });
    }

    simulateError(error: Error): void {
        process.nextTick(() => {
            this.emit('error', error);
        });
    }

    getDiscoveredServices(): ServiceUpdate[] {
        return Array.from(this.discoveredServices.values());
    }

    isActive(): boolean {
        return this.isRunning;
    }
}

export function createAdvertisement(name: string, port: number, options: ServiceOptions): Advertisement {
    return new Advertisement(name, port, options);
}

export function createBrowser(serviceName: string): Browser {
    return new Browser(serviceName);
}