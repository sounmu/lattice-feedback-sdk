import { describe, expect, it } from 'vitest';

import { findNotionConfig } from '@/lib/notion-config';

describe('findNotionConfig', () => {
  it('is null without a token', () => {
    expect(findNotionConfig({ NOTION_DATABASE_ID: 'db' })).toBeNull();
  });

  it('is null without a target', () => {
    expect(findNotionConfig({ NOTION_API_KEY: 'secret' })).toBeNull();
  });

  it('treats blank values as missing', () => {
    expect(findNotionConfig({ NOTION_API_KEY: '  ', NOTION_DATABASE_ID: 'db' })).toBeNull();
  });

  it('uses a database id with the default title column', () => {
    expect(findNotionConfig({ NOTION_API_KEY: ' secret ', NOTION_DATABASE_ID: ' db ' })).toEqual({
      token: 'secret',
      parent: { kind: 'database', id: 'db' },
      titleProperty: 'Name',
    });
  });

  it('prefers a data source id over a database id', () => {
    const config = findNotionConfig({ NOTION_API_KEY: 'secret', NOTION_DATABASE_ID: 'db', NOTION_DATA_SOURCE_ID: 'source' });

    expect(config?.parent).toEqual({ kind: 'data_source', id: 'source' });
  });

  it('uses a custom title column name', () => {
    const config = findNotionConfig({ NOTION_API_KEY: 'secret', NOTION_DATABASE_ID: 'db', NOTION_TITLE_PROPERTY: '이름' });

    expect(config?.titleProperty).toBe('이름');
  });
});
