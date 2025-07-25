import { EventEmitter } from 'events';

export class Advertisement extends EventEmitter {
    private name: string;
    private port: number;
    private options: any;

    constructor(name: string, port: number, options: any) {
        super();
        this.name = name;
        this.port = port;
        this.options = options;
    }

    start() {
        process.nextTick(() => {
            this.emit('ready');
            this.emit('started');
        });
    }

    stop() {
        process.nextTick(() => {
            this.emit('stopped');
        });
    }
}

export class Browser extends EventEmitter {
    private serviceName: string;

    constructor(serviceName: string) {
        super();
        this.serviceName = serviceName;
    }

    discover() {
        process.nextTick(() => {
            this.emit('ready');
            this.emit('update', {
                addresses: ['127.0.0.1'],
                port: 8080,
                txt: {
                    environment: 'test',
                    capabilities: 'compute,storage'
                },
                name: this.serviceName
            });
        });
    }

    start() {
        process.nextTick(() => {
            this.emit('ready');
            this.emit('update', {
                addresses: ['127.0.0.1'],
                port: 8080,
                txt: {
                    environment: 'test',
                    capabilities: 'compute,storage'
                },
                name: this.serviceName
            });
        });
    }

    stop() {
        process.nextTick(() => {
            this.emit('stopped');
        });
    }
}

export function createAdvertisement(name: string, port: number, options: any): Advertisement {
    return new Advertisement(name, port, options);
}

export function createBrowser(serviceName: string): Browser {
    return new Browser(serviceName);
}