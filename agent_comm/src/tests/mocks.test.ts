import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Advertisement, Browser } from './__mocks__/mdns-js';

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
                const errorHandler = vi.fn();

                advertisement.on('stopped', stoppedHandler);
                advertisement.on('error', errorHandler);

                // Start first, then stop
                advertisement.start();
                process.nextTick(() => {
                    advertisement.stop();

                    process.nextTick(() => {
                        expect(stoppedHandler).toHaveBeenCalled();
                        expect(errorHandler).not.toHaveBeenCalled();
                        resolve();
                    });
                });
            });
        });

        it('should emit error when stopping without starting', () => {
            return new Promise<void>((resolve) => {
                const errorHandler = vi.fn();
                const stoppedHandler = vi.fn();

                advertisement.on('error', errorHandler);
                advertisement.on('stopped', stoppedHandler);

                advertisement.stop();

                process.nextTick(() => {
                    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
                    expect(stoppedHandler).not.toHaveBeenCalled();
                    resolve();
                });
            });
        });

        it('should properly handle event listeners', () => {
            const handler = vi.fn();
            
            advertisement.on('test', handler);
            advertisement.emit('test');
            
            expect(handler).toHaveBeenCalled();
            
            advertisement.removeListener('test', handler);
            advertisement.emit('test');
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('should handle once listeners correctly', () => {
            const handler = vi.fn();
            
            advertisement.once('test', handler);
            advertisement.emit('test');
            advertisement.emit('test');

            expect(handler).toHaveBeenCalledTimes(1);
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
                const errorHandler = vi.fn();

                browser.on('stopped', stoppedHandler);
                browser.on('error', errorHandler);

                // Start first, then stop
                browser.start();
                process.nextTick(() => {
                    browser.stop();

                    process.nextTick(() => {
                        expect(stoppedHandler).toHaveBeenCalled();
                        expect(errorHandler).not.toHaveBeenCalled();
                        resolve();
                    });
                });
            });
        });

        it('should emit error when stopping without starting', () => {
            return new Promise<void>((resolve) => {
                const errorHandler = vi.fn();
                const stoppedHandler = vi.fn();

                browser.on('error', errorHandler);
                browser.on('stopped', stoppedHandler);

                browser.stop();

                process.nextTick(() => {
                    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
                    expect(stoppedHandler).not.toHaveBeenCalled();
                    resolve();
                });
            });
        });

        it('should properly handle event listeners', () => {
            const handler = vi.fn();
            
            browser.on('test', handler);
            browser.emit('test');
            
            expect(handler).toHaveBeenCalled();
            
            browser.removeListener('test', handler);
            browser.emit('test');
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('should handle once listeners correctly', () => {
            const handler = vi.fn();
            
            browser.once('test', handler);
            browser.emit('test');
            browser.emit('test');

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('should handle service discovery simulation', () => {
            return new Promise<void>((resolve) => {
                const updateHandler = vi.fn();
                const removedHandler = vi.fn();

                browser.on('update', updateHandler);
                browser.on('removed', removedHandler);

                browser.start();

                process.nextTick(() => {
                    const newService = {
                        addresses: ['192.168.1.100'],
                        port: 8081,
                        txt: {
                            environment: 'test',
                            capabilities: 'storage'
                        },
                        name: 'test-service-2'
                    };

                    browser.simulateServiceFound(newService);

                    process.nextTick(() => {
                        expect(updateHandler).toHaveBeenCalledWith(newService);
                        
                        browser.simulateServiceLost('test-service-2');

                        process.nextTick(() => {
                            expect(removedHandler).toHaveBeenCalledWith({ name: 'test-service-2' });
                            resolve();
                        });
                    });
                });
            });
        });
    });
});