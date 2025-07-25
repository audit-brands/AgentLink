import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Advertisement, Browser } from './../../src/tests/__mocks__/mdns-js';

describe('Mock Classes', () => {
    describe('Advertisement', () => {
        let advertisement: Advertisement;

        beforeEach(() => {
            advertisement = new Advertisement('test-service', 8080, {});
        });

        it('should emit ready and started events when start is called', () => {
            return new Promise<void>((resolve) => {
                const readyHandler = vi.fn();
                const startedHandler = vi.fn();

                advertisement.on('ready', readyHandler);
                advertisement.on('started', startedHandler);

                advertisement.start();
                
                process.nextTick(() => {
                    expect(readyHandler).toHaveBeenCalled();
                    expect(startedHandler).toHaveBeenCalled();
                    resolve();
                });
            });
        });

        it('should emit stopped event when stop is called', () => {
            return new Promise<void>((resolve) => {
                const stoppedHandler = vi.fn();

                advertisement.on('stopped', stoppedHandler);
                advertisement.stop();

                process.nextTick(() => {
                    expect(stoppedHandler).toHaveBeenCalled();
                    resolve();
                });
            });
        });

        it('should properly handle event listeners', () => {
            return new Promise<void>((resolve) => {
                const handler = vi.fn();
                
                advertisement.on('test', handler);
                advertisement.emit('test');
                
                process.nextTick(() => {
                    expect(handler).toHaveBeenCalled();
                    
                    advertisement.removeListener('test', handler);
                    advertisement.emit('test');
                    
                    expect(handler).toHaveBeenCalledTimes(1);
                    resolve();
                });
            });
        });

        it('should handle once listeners correctly', () => {
            return new Promise<void>((resolve) => {
                const handler = vi.fn();
                
                advertisement.once('test', handler);
                advertisement.emit('test');
                advertisement.emit('test');

                process.nextTick(() => {
                    expect(handler).toHaveBeenCalledTimes(1);
                    resolve();
                });
            });
        });
    });

    describe('Browser', () => {
        let browser: Browser;

        beforeEach(() => {
            browser = new Browser('test-service');
        });

        it('should emit ready and update events when discover is called', () => {
            return new Promise<void>((resolve) => {
                const readyHandler = vi.fn();
                const updateHandler = vi.fn();

                browser.on('ready', readyHandler);
                browser.on('update', updateHandler);

                browser.discover();

                process.nextTick(() => {
                    expect(readyHandler).toHaveBeenCalled();
                    expect(updateHandler).toHaveBeenCalledWith({
                        addresses: ['127.0.0.1'],
                        port: 8080,
                        txt: {
                            environment: 'test',
                            capabilities: 'compute,storage'
                        },
                        name: 'test-service'
                    });
                    resolve();
                });
            });
        });

        it('should emit ready and update events when start is called', () => {
            return new Promise<void>((resolve) => {
                const readyHandler = vi.fn();
                const updateHandler = vi.fn();

                browser.on('ready', readyHandler);
                browser.on('update', updateHandler);

                browser.start();

                process.nextTick(() => {
                    expect(readyHandler).toHaveBeenCalled();
                    expect(updateHandler).toHaveBeenCalledWith({
                        addresses: ['127.0.0.1'],
                        port: 8080,
                        txt: {
                            environment: 'test',
                            capabilities: 'compute,storage'
                        },
                        name: 'test-service'
                    });
                    resolve();
                });
            });
        });

        it('should emit stopped event when stop is called', () => {
            return new Promise<void>((resolve) => {
                const stoppedHandler = vi.fn();

                browser.on('stopped', stoppedHandler);
                browser.stop();

                process.nextTick(() => {
                    expect(stoppedHandler).toHaveBeenCalled();
                    resolve();
                });
            });
        });

        it('should properly handle event listeners', () => {
            return new Promise<void>((resolve) => {
                const handler = vi.fn();
                
                browser.on('test', handler);
                browser.emit('test');
                
                process.nextTick(() => {
                    expect(handler).toHaveBeenCalled();
                    
                    browser.removeListener('test', handler);
                    browser.emit('test');
                    
                    expect(handler).toHaveBeenCalledTimes(1);
                    resolve();
                });
            });
        });

        it('should handle once listeners correctly', () => {
            return new Promise<void>((resolve) => {
                const handler = vi.fn();
                
                browser.once('test', handler);
                browser.emit('test');
                browser.emit('test');

                process.nextTick(() => {
                    expect(handler).toHaveBeenCalledTimes(1);
                    resolve();
                });
            });
        });
    });
});