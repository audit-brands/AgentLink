import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { NetworkManager, NetworkConfig } from '../services/networkManager';
import { ResourceManager } from '../services/resourceManager';
import { Network } from '../network';

// Mock WebSocket module
vi.mock('ws', () => {
    const mockWebSocket = vi.fn(() => new MockWebSocket());
    const mockWebSocketServer = vi.fn((options?: any) => new MockWebSocketServer(options));

    mockWebSocket.Server = mockWebSocketServer;
    mockWebSocket.CONNECTING = 0;
    mockWebSocket.OPEN = 1;
    mockWebSocket.CLOSING = 2;
    mockWebSocket.CLOSED = 3;

    return mockWebSocket;
});

// Mock WebSocket implementation
class MockWebSocket extends EventEmitter {
    public readyState = WebSocket.OPEN;
    private bytesTransferred = { sent: 0, received: 0 };

    constructor() {
        super();
    }

    send = vi.fn((data: string | Buffer, callback?: (error?: Error) => void) => {
        if (this.readyState !== WebSocket.OPEN) {
            const error = new Error('WebSocket is not open');
            if (callback) callback(error);
            this.emit('error', error);
            return;
        }

        const byteLength = Buffer.isBuffer(data) ? data.length : Buffer.from(data).length;
        this.bytesTransferred.sent += byteLength;

        if (callback) callback();
        this.emit('sent', { data, byteLength });
    });

    close = vi.fn((code?: number, reason?: string) => {
        if (this.readyState === WebSocket.CLOSED) return;

        this.readyState = WebSocket.CLOSING;
        process.nextTick(() => {
            this.readyState = WebSocket.CLOSED;
            this.emit('close', code, reason);
        });
    });

    simulateMessage(data: string | Buffer): void {
        if (this.readyState !== WebSocket.OPEN) {
            throw new Error('Cannot simulate message on closed WebSocket');
        }

        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this.bytesTransferred.received += buffer.length;
        this.emit('message', buffer);
    }

    simulateError(error: Error): void {
        this.emit('error', error);
    }

    simulateOpen(): void {
        if (this.readyState === WebSocket.CONNECTING) {
            this.readyState = WebSocket.OPEN;
            this.emit('open');
        }
    }

    getMetrics(): { sent: number; received: number } {
        return { ...this.bytesTransferred };
    }

    reset(): void {
        this.readyState = WebSocket.OPEN;
        this.bytesTransferred = { sent: 0, received: 0 };
        this.removeAllListeners();
    }
}

// Mock WebSocket Server implementation
class MockWebSocketServer extends EventEmitter {
    private clients: Set<MockWebSocket> = new Set();
    private isRunning: boolean = false;

    constructor(options: any = {}) {
        super();
        this.isRunning = true;
    }

    on = vi.fn((event: string, listener: (...args: any[]) => void) => {
        return super.on(event, listener);
    });

    close = vi.fn((callback?: () => void) => {
        if (!this.isRunning) {
            if (callback) callback();
            return;
        }

        this.clients.forEach(client => {
            client.close(1001, 'Server shutting down');
        });
        this.clients.clear();
        this.isRunning = false;

        process.nextTick(() => {
            this.emit('close');
            if (callback) callback();
        });
    });

    simulateConnection(socket: MockWebSocket = new MockWebSocket()): void {
        if (!this.isRunning) {
            throw new Error('Server is not running');
        }

        this.clients.add(socket);
        this.emit('connection', socket);
    }

    simulateError(error: Error): void {
        this.emit('error', error);
    }

    getClients(): Set<MockWebSocket> {
        return new Set(this.clients);
    }

    isActive(): boolean {
        return this.isRunning;
    }
}

vi.mock('../services/resourceManager');
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

describe('NetworkManager', () => {
    let networkManager: NetworkManager;
    let resourceManager: ResourceManager;
    let config: NetworkConfig;
    let mockWs: MockWebSocket;
    let mockServer: MockWebSocketServer;

    beforeEach(() => {
        config = {
            port: 8080,
            serviceName: 'test-service',
            environment: 'test'
        };

        resourceManager = new ResourceManager({
            memory: {
                max: 8 * 1024 * 1024 * 1024,
                warning: 6 * 1024 * 1024 * 1024
            },
            cpu: {
                maxUsage: 80,
                warning: 60
            }
        });

        networkManager = new NetworkManager(config, resourceManager);
        mockWs = new MockWebSocket();
        mockServer = new MockWebSocketServer();
        
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await networkManager.stop();
    });

    describe('Service Discovery', () => {
        it('should advertise service and discover peers', async () => {
            const discoveryHandler = vi.fn();
            networkManager.on('peerDiscovered', discoveryHandler);

            await networkManager.start();

            // Simulate peer discovery
            const testPeer = {
                name: 'test-peer',
                addresses: ['192.168.1.100'],
                port: 8081,
                txt: {
                    environment: 'test',
                    capabilities: 'task1,task2'
                }
            };

            networkManager.network.getBrowser()?.simulateServiceFound(testPeer);

            // Wait for discovery processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(discoveryHandler).toHaveBeenCalledWith({
                name: testPeer.name,
                address: testPeer.addresses[0],
                port: testPeer.port,
                capabilities: ['task1', 'task2']
            });
        });

        it('should handle discovery errors gracefully', async () => {
            const errorHandler = vi.fn();
            networkManager.on('error', errorHandler);

            await networkManager.start();

            // Simulate discovery error
            networkManager.network.getBrowser()?.emit('error', new Error('Discovery failed'));

            expect(errorHandler).toHaveBeenCalledWith({
                component: 'mdns-browser',
                error: expect.any(Error)
            });
        });

        it('should handle advertisement lifecycle events', async () => {
            const readyHandler = vi.fn();
            const startedHandler = vi.fn();
            const stoppedHandler = vi.fn();

            networkManager.on('ready', readyHandler);
            networkManager.network.getAdvertisement()?.on('started', startedHandler);
            networkManager.network.getAdvertisement()?.on('stopped', stoppedHandler);

            await networkManager.start();
            expect(readyHandler).toHaveBeenCalled();
            expect(startedHandler).toHaveBeenCalled();

            await networkManager.stop();
            expect(stoppedHandler).toHaveBeenCalled();
        });
    });

    describe('WebSocket Communication', () => {
        it('should handle client connections', async () => {
            const connectHandler = vi.fn();
            networkManager.on('peerConnected', connectHandler);

            await networkManager.start();
            mockServer.simulateConnection(mockWs);

            expect(connectHandler).toHaveBeenCalledWith(expect.any(String));
        });

        it('should handle client disconnection', async () => {
            const disconnectHandler = vi.fn();
            networkManager.on('peerDisconnected', disconnectHandler);

            await networkManager.start();
            mockServer.simulateConnection(mockWs);
            mockWs.close();

            expect(disconnectHandler).toHaveBeenCalledWith(expect.any(String));
            expect(networkManager.getMetrics().connectedPeers).toBe(0);
        });

        it('should handle client messages', async () => {
            const messageHandler = vi.fn();
            networkManager.on('taskRequest', messageHandler);

            await networkManager.start();
            mockServer.simulateConnection(mockWs);

            const testMessage = {
                type: 'taskRequest',
                data: { taskId: 'test-task' }
            };
            mockWs.simulateMessage(JSON.stringify(testMessage));

            expect(messageHandler).toHaveBeenCalledWith({
                peerId: expect.any(String),
                data: testMessage.data
            });
        });

        it('should handle malformed messages', async () => {
            const errorHandler = vi.fn();
            networkManager.on('error', errorHandler);

            await networkManager.start();
            mockServer.simulateConnection(mockWs);
            mockWs.simulateMessage('invalid json');

            expect(errorHandler).toHaveBeenCalledWith({
                peerId: expect.any(String),
                error: expect.any(Error),
                data: expect.any(Buffer)
            });
        });

        it('should handle health checks', async () => {
            await networkManager.start();
            mockServer.simulateConnection(mockWs);

            const healthCheck = {
                type: 'healthCheck'
            };
            mockWs.simulateMessage(JSON.stringify(healthCheck));

            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('healthCheckResponse'),
                expect.any(Function)
            );
        });
    });

    describe('Broadcast', () => {
        it('should broadcast messages to all connected peers', async () => {
            await networkManager.start();
            mockServer.simulateConnection(mockWs);

            const testMessage = {
                type: 'broadcast',
                data: 'test message'
            };

            await networkManager.broadcast(testMessage);

            expect(mockWs.send).toHaveBeenCalledWith(
                JSON.stringify(testMessage),
                expect.any(Function)
            );
        });

        it('should handle broadcast errors', async () => {
            const errorHandler = vi.fn();
            networkManager.on('error', errorHandler);

            await networkManager.start();
            mockServer.simulateConnection(mockWs);

            mockWs.send.mockImplementation((data: string, cb: (error?: Error) => void) => {
                cb(new Error('Send failed'));
            });

            const testMessage = {
                type: 'broadcast',
                data: 'test message'
            };

            await expect(networkManager.broadcast(testMessage)).rejects.toThrow('Send failed');
            expect(errorHandler).toHaveBeenCalledWith({
                peerId: expect.any(String),
                error: expect.any(Error)
            });
        });
    });

    describe('Metrics', () => {
        it('should track connection metrics', async () => {
            await networkManager.start();
            
            expect(networkManager.getMetrics().connectedPeers).toBe(0);
            
            mockServer.simulateConnection(mockWs);
            expect(networkManager.getMetrics().connectedPeers).toBe(1);
            
            mockWs.close();
            expect(networkManager.getMetrics().connectedPeers).toBe(0);
        });

        it('should track bytes transferred', async () => {
            await networkManager.start();
            mockServer.simulateConnection(mockWs);

            const initialMetrics = networkManager.getMetrics();
            const testMessage = { type: 'test', data: 'message' };
            const messageSize = Buffer.from(JSON.stringify(testMessage)).length;

            mockWs.simulateMessage(JSON.stringify(testMessage));

            const updatedMetrics = networkManager.getMetrics();
            expect(updatedMetrics.bytesTransferred.received).toBe(
                initialMetrics.bytesTransferred.received + messageSize
            );
        });
    });

    describe('SSL Configuration', () => {
        it('should start with SSL configuration', async () => {
            const sslConfig: NetworkConfig = {
                ...config,
                ssl: {
                    key: '/path/to/test.key',
                    cert: '/path/to/test.cert'
                }
            };

            const secureNetworkManager = new NetworkManager(sslConfig, resourceManager);
            await secureNetworkManager.start();

            const mockConstructor = vi.mocked(MockWebSocketServer);
            expect(mockConstructor).toHaveBeenCalledWith({
                port: sslConfig.port,
                cert: sslConfig.ssl?.cert,
                key: sslConfig.ssl?.key
            });

            await secureNetworkManager.stop();
        });
    });
});