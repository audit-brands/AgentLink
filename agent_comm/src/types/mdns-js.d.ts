declare module 'mdns-js' {
    import { EventEmitter } from 'events';

    export interface Advertisement extends EventEmitter {
        name: string;
        port: number;
        options: any;
        start(): void;
        stop(): void;
    }

    export interface Browser extends EventEmitter {
        serviceName: string;
        start(): void;
        stop(): void;
        discover(): void;
    }

    export function createAdvertisement(name: string, port: number, options: any): Advertisement;
    export function createBrowser(serviceName: string): Browser;
}