import { EventEmitter } from 'events';
import { vi } from 'vitest';

export enum WebSocketState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3
}

export class MockWebSocket extends EventEmitter {
    public readyState: WebSocketState = WebSocketState.OPEN;
    private bytesTransferred: { sent: number; received: number } = { sent: 0, received: 0 };

    send = vi.fn((data: string | Buffer, callback?: (error?: Error) => void) => {
        if (this.readyState !== WebSocketState.OPEN) {
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
        if (this.readyState === WebSocketState.CLOSED) {
            return;
        }

        this.readyState = WebSocketState.CLOSING;
        process.nextTick(() => {
            this.readyState = WebSocketState.CLOSED;
            this.emit('close', code, reason);
        });
    });

    simulateMessage(data: string | Buffer): void {
        if (this.readyState !== WebSocketState.OPEN) {
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
        if (this.readyState === WebSocketState.CONNECTING) {
            this.readyState = WebSocketState.OPEN;
            this.emit('open');
        }
    }

    getMetrics(): { sent: number; received: number } {
        return { ...this.bytesTransferred };
    }

    reset(): void {
        this.readyState = WebSocketState.OPEN;
        this.bytesTransferred = { sent: 0, received: 0 };
        this.removeAllListeners();
    }
}

export class MockWebSocketServer extends EventEmitter {
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

const mockWebSocket = vi.fn(() => new MockWebSocket());
const mockWebSocketServer = vi.fn((options?: any) => new MockWebSocketServer(options));

mockWebSocket.Server = mockWebSocketServer;
mockWebSocket.CONNECTING = WebSocketState.CONNECTING;
mockWebSocket.OPEN = WebSocketState.OPEN;
mockWebSocket.CLOSING = WebSocketState.CLOSING;
mockWebSocket.CLOSED = WebSocketState.CLOSED;

export default mockWebSocket;