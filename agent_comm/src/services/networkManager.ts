import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Network } from '../network';
import { ResourceManager } from './resourceManager';

export interface NetworkConfig {
    port: number;
    serviceName: string;
    environment: string;
    ssl?: {
        key: string;
        cert: string;
    };
}

interface NetworkMetrics {
    connectedPeers: number;
    bytesTransferred: {
        sent: number;
        received: number;
    };
}

export class NetworkManager extends EventEmitter {
    private network: Network;
    private server: WebSocket.Server | null = null;
    private peers: Map<string, WebSocket> = new Map();
    private config: NetworkConfig;
    private resourceManager: ResourceManager;
    private metrics: NetworkMetrics = {
        connectedPeers: 0,
        bytesTransferred: {
            sent: 0,
            received: 0
        }
    };

    constructor(config: NetworkConfig, resourceManager: ResourceManager) {
        super();
        this.config = config;
        this.resourceManager = resourceManager;
        this.network = new Network();
    }

    async start(): Promise<void> {
        // Start service advertisement
        const advertisement = this.network.advertise(
            this.config.serviceName,
            this.config.port,
            {
                environment: this.config.environment
            }
        );

        advertisement.on('error', (error) => {
            this.emit('error', { component: 'mdns-advertisement', error });
        });

        // Start service discovery
        const browser = this.network.discover(this.config.serviceName);

        browser.on('update', (service) => {
            if (service.txt.environment === this.config.environment) {
                this.emit('peerDiscovered', {
                    name: service.name,
                    address: service.addresses[0],
                    port: service.port,
                    capabilities: service.txt.capabilities?.split(',') || []
                });
            }
        });

        browser.on('error', (error) => {
            this.emit('error', { component: 'mdns-browser', error });
        });

        // Initialize WebSocket server
        const serverOptions: WebSocket.ServerOptions = {
            port: this.config.port
        };

        if (this.config.ssl) {
            serverOptions.cert = this.config.ssl.cert;
            serverOptions.key = this.config.ssl.key;
        }

        this.server = new WebSocket.Server(serverOptions);

        this.server.on('connection', (socket: WebSocket) => {
            const peerId = `peer-${Math.random().toString(36).substr(2, 9)}`;
            this.peers.set(peerId, socket);
            this.metrics.connectedPeers = this.peers.size;

            this.emit('peerConnected', peerId);

            socket.on('message', (data: Buffer) => {
                this.metrics.bytesTransferred.received += data.length;

                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(peerId, message);
                } catch (error) {
                    this.emit('error', {
                        peerId,
                        error: new Error('Invalid message format'),
                        data
                    });
                }
            });

            socket.on('close', () => {
                this.peers.delete(peerId);
                this.metrics.connectedPeers = this.peers.size;
                this.emit('peerDisconnected', peerId);
            });

            socket.on('error', (error) => {
                this.emit('error', { peerId, error });
            });
        });

        // Start metrics collection
        setInterval(() => {
            this.emit('metrics', this.getMetrics());
        }, 5000);

        this.emit('ready', {
            port: this.config.port,
            secure: !!this.config.ssl
        });
    }

    async stop(): Promise<void> {
        this.network.stopAdvertising();
        this.network.stopDiscovery();

        for (const [peerId, socket] of this.peers.entries()) {
            socket.close();
            this.peers.delete(peerId);
        }

        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server!.close(() => resolve());
            });
            this.server = null;
        }

        this.metrics.connectedPeers = 0;
    }

    async broadcast(message: any): Promise<void> {
        const messageStr = JSON.stringify(message);
        const messageBuffer = Buffer.from(messageStr);

        const sendPromises = Array.from(this.peers.entries()).map(
            ([peerId, socket]) =>
                new Promise<void>((resolve, reject) => {
                    socket.send(messageStr, (error) => {
                        if (error) {
                            this.emit('error', { peerId, error });
                            reject(error);
                        } else {
                            this.metrics.bytesTransferred.sent += messageBuffer.length;
                            resolve();
                        }
                    });
                })
        );

        await Promise.all(sendPromises);
    }

    getPeers(): Array<{ id: string; address: string }> {
        return Array.from(this.peers.keys()).map((id) => ({
            id,
            address: 'peer-address' // In a real implementation, we would store and return actual peer addresses
        }));
    }

    getMetrics(): NetworkMetrics {
        return {
            ...this.metrics,
            ...this.resourceManager.getMetrics()
        };
    }

    private handleMessage(peerId: string, message: any): void {
        switch (message.type) {
            case 'taskRequest':
                this.emit('taskRequest', { peerId, data: message.data });
                break;

            case 'healthCheck':
                const response = {
                    type: 'healthCheckResponse',
                    data: {
                        status: 'healthy',
                        metrics: this.getMetrics()
                    }
                };
                const socket = this.peers.get(peerId);
                if (socket) {
                    const responseStr = JSON.stringify(response);
                    socket.send(responseStr);
                    this.metrics.bytesTransferred.sent += Buffer.from(responseStr).length;
                }
                break;

            case 'resourceUpdate':
                this.emit('resourceUpdate', { peerId, data: message.data });
                break;

            default:
                this.emit('unknownMessage', { peerId, message });
        }
    }
}