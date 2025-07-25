import { EventEmitter } from 'events';
import { Advertisement, Browser, createAdvertisement, createBrowser } from './tests/__mocks__/mdns-js';

export class Network {
    private advertisement: Advertisement | null = null;
    private browser: Browser | null = null;

    advertise(name: string, port: number, options: any): Advertisement {
        if (this.advertisement) {
            this.stopAdvertising();
        }

        this.advertisement = createAdvertisement(name, port, options);
        this.advertisement.start();
        return this.advertisement;
    }

    stopAdvertising(): void {
        if (this.advertisement) {
            this.advertisement.stop();
            this.advertisement = null;
        }
    }

    discover(serviceName: string): Browser {
        if (this.browser) {
            this.stopDiscovery();
        }

        this.browser = createBrowser(serviceName);
        this.browser.start();
        return this.browser;
    }

    stopDiscovery(): void {
        if (this.browser) {
            this.browser.stop();
            this.browser = null;
        }
    }

    getAdvertisement(): Advertisement | null {
        return this.advertisement;
    }

    getBrowser(): Browser | null {
        return this.browser;
    }
}