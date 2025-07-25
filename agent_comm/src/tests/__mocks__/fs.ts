import { vi } from 'vitest';

export const readFileSync = vi.fn((path: string) => {
    if (path.includes('test.key')) {
        return '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC9QFi7oXDaNuaX\n-----END PRIVATE KEY-----';
    }
    if (path.includes('test.cert')) {
        return '-----BEGIN CERTIFICATE-----\nMIIDazCCAlOgAwIBAgIUBEMQvXBTqHHWJj8eiIpP8B0pbVQwDQYJKoZIhvcNAQEL\n-----END CERTIFICATE-----';
    }
    throw new Error('File not found');
});