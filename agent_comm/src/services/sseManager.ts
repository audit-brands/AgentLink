import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

interface SSEClient {
    id: string;
    response: Response;
    topics: string[];
}

/**
 * Server-Sent Events (SSE) manager for real-time updates
 */
export class SSEManager extends EventEmitter {
    private clients: Map<string, SSEClient> = new Map();
    private retryInterval: number = 3000;

    constructor() {
        super();
    }

    /**
     * Initializes SSE connection for a client
     */
    public connect(req: Request, res: Response, topics: string[] = []): string {
        const clientId = uuidv4();

        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // Disable Nginx buffering
        });

        // Send retry interval
        res.write(`retry: ${this.retryInterval}\n\n`);

        // Store client
        this.clients.set(clientId, {
            id: clientId,
            response: res,
            topics
        });

        // Handle client disconnect
        req.on('close', () => this.disconnect(clientId));

        return clientId;
    }

    /**
     * Disconnects a client
     */
    public disconnect(clientId: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.response.end();
            this.clients.delete(clientId);
        }
    }

    /**
     * Sends event to all subscribed clients
     */
    public broadcast(topic: string, event: string, data: unknown): void {
        this.clients.forEach(client => {
            if (client.topics.length === 0 || client.topics.includes(topic)) {
                this.sendEvent(client.id, event, data);
            }
        });
    }

    /**
     * Sends event to a specific client
     */
    public sendEvent(clientId: string, event: string, data: unknown): void {
        const client = this.clients.get(clientId);
        if (!client) return;

        const message = this.formatSSEMessage(event, data);
        client.response.write(message);
    }

    /**
     * Formats message in SSE format
     */
    private formatSSEMessage(event: string, data: unknown): string {
        let message = `event: ${event}\n`;
        
        if (typeof data === 'string') {
            message += `data: ${data}\n`;
        } else {
            message += `data: ${JSON.stringify(data)}\n`;
        }

        return message + '\n';
    }

    /**
     * Updates client topic subscriptions
     */
    public updateTopics(clientId: string, topics: string[]): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.topics = topics;
        }
    }

    /**
     * Gets all connected clients
     */
    public getClients(): Map<string, SSEClient> {
        return new Map(this.clients);
    }

    /**
     * Sets retry interval for reconnection
     */
    public setRetryInterval(interval: number): void {
        this.retryInterval = interval;
        this.clients.forEach(client => {
            client.response.write(`retry: ${interval}\n\n`);
        });
    }

    /**
     * Closes all connections
     */
    public close(): void {
        this.clients.forEach(client => {
            client.response.end();
        });
        this.clients.clear();
    }
}