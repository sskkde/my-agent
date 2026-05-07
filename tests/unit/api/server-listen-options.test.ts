import { describe, it, expect } from 'vitest';
import { resolveListenOptions } from '../../../src/api/server.js';

describe('resolveListenOptions', () => {
  it('defaults to port 3003 and host localhost in non-production', () => {
    const result = resolveListenOptions({});
    expect(result).toEqual({ port: 3003, host: 'localhost' });
  });

  it('defaults to localhost even when NODE_ENV is production', () => {
    const result = resolveListenOptions({ NODE_ENV: 'production' });
    expect(result).toEqual({ port: 3003, host: 'localhost' });
  });

  it('HOST env var overrides the default host', () => {
    const result = resolveListenOptions({ HOST: '127.0.0.1' });
    expect(result).toEqual({ port: 3003, host: '127.0.0.1' });
  });

  it('HOST env var overrides even in production', () => {
    const result = resolveListenOptions({ NODE_ENV: 'production', HOST: '127.0.0.1' });
    expect(result).toEqual({ port: 3003, host: '127.0.0.1' });
  });

  it('PORT env var overrides the default port', () => {
    const result = resolveListenOptions({ PORT: '8080' });
    expect(result).toEqual({ port: 8080, host: 'localhost' });
  });

  it('PORT and HOST can be overridden together', () => {
    const result = resolveListenOptions({ PORT: '4000', HOST: '0.0.0.0' });
    expect(result).toEqual({ port: 4000, host: '0.0.0.0' });
  });

  it('throws on non-numeric PORT', () => {
    expect(() => resolveListenOptions({ PORT: 'abc' })).toThrow('Invalid PORT "abc"');
  });

  it('throws on out-of-range PORT', () => {
    expect(() => resolveListenOptions({ PORT: '99999' })).toThrow('Invalid PORT "99999"');
  });

  it('throws on negative PORT', () => {
    expect(() => resolveListenOptions({ PORT: '-1' })).toThrow('Invalid PORT "-1"');
  });

  it('throws on partial numeric PORT like 123abc', () => {
    expect(() => resolveListenOptions({ PORT: '123abc' })).toThrow('Invalid PORT "123abc"');
  });

  it('throws on empty PORT string', () => {
    expect(() => resolveListenOptions({ PORT: '' })).toThrow('Invalid PORT ""');
  });

  it('throws on decimal PORT like 3003.5', () => {
    expect(() => resolveListenOptions({ PORT: '3003.5' })).toThrow('Invalid PORT "3003.5"');
  });

  it('allows port 0 for dynamic assignment', () => {
    const result = resolveListenOptions({ PORT: '0' });
    expect(result).toEqual({ port: 0, host: 'localhost' });
  });
});
