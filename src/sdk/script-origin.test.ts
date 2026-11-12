import { describe, expect, it } from 'vitest';
import { findOriginFromScriptSource, isSdkScriptSource } from '@/sdk/script-origin';

describe('findOriginFromScriptSource', () => {
  it('returns the origin of an https script src', () => {
    expect(findOriginFromScriptSource('https://feedback.example.com/sdk.js?v=3')).toBe('https://feedback.example.com');
  });

  it('keeps a non-default port', () => {
    expect(findOriginFromScriptSource('http://localhost:3000/sdk.js')).toBe('http://localhost:3000');
  });

  it('returns null for relative, non-http, or invalid sources', () => {
    expect(findOriginFromScriptSource('/sdk.js')).toBeNull();
    expect(findOriginFromScriptSource('data:text/javascript,alert(1)')).toBeNull();
    expect(findOriginFromScriptSource('')).toBeNull();
  });
});

describe('isSdkScriptSource', () => {
  it('matches sdk.js regardless of query string', () => {
    expect(isSdkScriptSource('https://feedback.example.com/sdk.js?v=3')).toBe(true);
  });

  it('rejects other scripts', () => {
    expect(isSdkScriptSource('https://cdn.example.com/my-sdk.js.map')).toBe(false);
    expect(isSdkScriptSource('https://cdn.example.com/app.js')).toBe(false);
  });
});
