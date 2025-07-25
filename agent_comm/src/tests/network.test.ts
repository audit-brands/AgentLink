import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Network } from '../network';

vi.mock('../network', () => {
    const { EventEmitter } = require('events');
    
    class MockAdvertisement extends EventEmitter {
        private isRunning: boolean = false;
        name: string;
        port: number;
        options: any;

        constructor(name: string, port: number, options: any) {
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

    class MockBrowser extends EventEmitter {
        private isRunning: boolean = false;
        private discoveredServices: Map<string, any> = new Map();
        serviceName: string;

        constructor(serviceName: string) {
            super();
            this.serviceName = serviceName;
        }

        start(): void {
            if (this.isRunning) {
                this.emit('error', new Error('Browser already running'));
                return;
            }

            this.isRunning = true;
            process.nextTick(() => {
                this.emit('ready');
                // Simulate initial service discovery
                if (this.isRunning) {
                    const defaultService = {
                        addresses: ['127.0.0.1'],
                        port: 8080,
                        txt: {
                            environment: 'test',
                            capabilities: 'compute,storage'
                        },
                        name: this.serviceName
                    };
                    this.discoveredServices.set(this.serviceName, defaultService);
                    this.emit('update', defaultService);
                }
            });
        }

        stop(): void {
            if (!this.isRunning) {
                this.emit('error', new Error('Browser not running'));
                return;
            }

            const wasRunning = this.isRunning;
            this.isRunning = false;
            this.discoveredServices.clear();
            
            if (wasRunning) {
                process.nextTick(() => {
                    this.emit('stopped');
                });
            }
        }

        simulateServiceFound(service: any): void {
            if (!this.isRunning) {
                throw new Error('Browser not running');
            }

            this.discoveredServices.set(service.name, service);
            this.emit('update', service);
        }

        simulateServiceLost(serviceName: string): void {
            if (!this.isRunning) {
                throw new Error('Browser not running');
            }

            if (this.discoveredServices.has(serviceName)) {
                this.discoveredServices.delete(serviceName);
                this.emit('removed', { name: serviceName });
            }
        }

        getDiscoveredServices(): any[] {
            return Array.from(this.discoveredServices.values());
        }

        isActive(): boolean {
            return this.isRunning;
        }
    }

    return {
        Network: vi.fn().mockImplementation(() => {
            let advertisement: MockAdvertisement | null = null;
            let browser: MockBrowser | null = null;

            return {
                advertise: vi.fn((name: string, port: number, options: any) => {
                    if (advertisement) {
                        advertisement.stop();
                    }
                    advertisement = new MockAdvertisement(name, port, options);
                    advertisement.start();
                    return advertisement;
                }),
                stopAdvertising: vi.fn(() => {
                    if (advertisement) {
                        advertisement.stop();
                        advertisement = null;
                    }
                }),
                discover: vi.fn((serviceName: string) => {
                    if (browser) {
                        browser.stop();
                    }
                    browser = new MockBrowser(serviceName);
                    browser.start();
                    return browser;
                }),
                stopDiscovery: vi.fn(() => {
                    if (browser) {
                        browser.stop();
                        browser = null;
                    }
                }),
                getAdvertisement: vi.fn(() => advertisement),
                getBrowser: vi.fn(() => browser)
            };
        })
    };
});

describe('Network', () => {
    let network: Network;
    const testServiceName = 'test-service';
    const testPort = 8080;

    beforeEach(() => {
        network = new Network();
        vi.clearAllMocks();
    });

    describe('Service Advertisement', () => {
        it('should create and start advertisement', () => {
            return new Promise<void>((resolve) => {
                const readyHandler = vi.fn();
                const startedHandler = vi.fn();
                
                network.advertise(testServiceName, testPort, {})
                    .on('ready', readyHandler)
                    .on('started', startedHandler);

                process.nextTick(() => {
                    expect(readyHandler).toHaveBeenCalledWith({
                        name: testServiceName,
                        port: testPort,
                        options: {}
                    });
                    expect(startedHandler).toHaveBeenCalled();
                    expect(network.getAdvertisement()).toBeDefined();
                    expect(network.getAdvertisement()?.isActive()).toBe(true);
                    resolve();
                });
            });
        });

        it('should stop advertisement', () => {
            return new Promise<void>((resolve) => {
                const stoppedHandler = vi.fn();
                
                const advert = network.advertise(testServiceName, testPort, {})
                    .on('stopped', stoppedHandler);

                network.stopAdvertising();

                process.nextTick(() => {
                    expect(stoppedHandler).toHaveBeenCalled();
                    expect(network.getAdvertisement()).toBeNull();
                    resolve();
                });
            });
        });

        it('should handle advertisement options', () => {
            const options = {
                environment: 'test',
                capabilities: ['compute', 'storage']
            };

            network.advertise(testServiceName, testPort, options);
            const advert = network.getAdvertisement();

            expect(advert).toBeDefined();
            expect(advert?.options).toEqual(options);
        });

        it('should prevent multiple advertisements', () => {
            const errorHandler = vi.fn();
            const advert = network.advertise(testServiceName, testPort, {});
            
            // Try to start a new advertisement while one is running
            network.advertise(testServiceName, testPort, {})
                .on('error', errorHandler);

            expect(errorHandler).toHaveBeenCalledWith(
                new Error('Advertisement already running')
            );
        });
    });

    describe('Service Discovery', () => {
        it('should discover services', async () => {
            const readyHandler = vi.fn();
            const updateHandler = vi.fn();
            
            const browser = network.discover(testServiceName)
                .on('ready', readyHandler)
                .on('update', updateHandler);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(readyHandler).toHaveBeenCalled();
            expect(updateHandler).toHaveBeenCalledWith({
                addresses: ['127.0.0.1'],
                port: 8080,
                txt: {
                    environment: 'test',
                    capabilities: 'compute,storage'
                },
                name: testServiceName
            });
            expect(browser.isActive()).toBe(true);
        });

        it('should stop discovery', async () => {
            const stoppedHandler = vi.fn();
            
            const browser = network.discover(testServiceName)
                .on('stopped', stoppedHandler);

            await new Promise(resolve => setTimeout(resolve, 100));
            network.stopDiscovery();

            expect(stoppedHandler).toHaveBeenCalled();
            expect(network.getBrowser()).toBeNull();
            expect(browser.isActive()).toBe(false);
        });

        it('should handle multiple service discoveries', async () => {
            const service1 = 'service-1';
            const service2 = 'service-2';
            
            const browser1 = network.discover(service1);
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const browser2 = network.discover(service2);
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(browser1.isActive()).toBe(false);
            expect(browser2.isActive()).toBe(true);
            expect(network.getBrowser()).toBe(browser2);

            network.stopDiscovery();
            expect(network.getBrowser()).toBeNull();
        });

        it('should handle service removal', async () => {
            const removedHandler = vi.fn();
            const browser = network.discover(testServiceName)
                .on('removed', removedHandler);

            await new Promise(resolve => setTimeout(resolve, 100));
            browser.simulateServiceLost(testServiceName);
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(removedHandler).toHaveBeenCalledWith({ name: testServiceName });
            expect(browser.getDiscoveredServices()).toHaveLength(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle advertisement errors', () => {
            const errorHandler = vi.fn();
            const advert = network.advertise(testServiceName, testPort, {})
                .on('error', errorHandler);

            advert.stop();
            advert.stop(); // Try to stop again
            
            expect(errorHandler).toHaveBeenCalledWith(
                new Error('Advertisement not running')
            );
        });

        it('should handle discovery errors', () => {
            const errorHandler = vi.fn();
            const browser = network.discover(testServiceName)
                .on('error', errorHandler);

            browser.stop();
            browser.stop(); // Try to stop again
            
            expect(errorHandler).toHaveBeenCalledWith(
                new Error('Browser not running')
            );
        });

        it('should handle service simulation errors', () => {
            const browser = network.discover(testServiceName);
            browser.stop();

            expect(() => browser.simulateServiceFound({
                name: 'test',
                addresses: ['127.0.0.1'],
                port: 8080
            })).toThrow('Browser not running');

            expect(() => browser.simulateServiceLost('test'))
                .toThrow('Browser not running');
        });
    });
});