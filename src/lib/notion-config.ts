// Reads the Notion settings from the environment. Returns null until the token and a target are set,
// so the ticket endpoint can answer "not configured" instead of failing half way.

export type NotionParent = { kind: 'data_source'; id: string } | { kind: 'database'; id: string };

export interface NotionConfig {
  token: string;
  parent: NotionParent;
  /** Name of the board's title column. Notion's default is "Name" (이름 in a Korean workspace). */
  titleProperty: string;
}

const DEFAULT_TITLE_PROPERTY = 'Name';

type Environment = Record<string, string | undefined>;

function findTrimmed(environment: Environment, name: string): string | null {
  const value = environment[name]?.trim();
  return value ? value : null;
}

function findParent(environment: Environment): NotionParent | null {
  const dataSourceId = findTrimmed(environment, 'NOTION_DATA_SOURCE_ID');
  if (dataSourceId) {
    return { kind: 'data_source', id: dataSourceId };
  }
  const databaseId = findTrimmed(environment, 'NOTION_DATABASE_ID');
  if (databaseId) {
    return { kind: 'database', id: databaseId };
  }
  return null;
}

export function findNotionConfig(environment: Environment = process.env): NotionConfig | null {
  const token = findTrimmed(environment, 'NOTION_API_KEY');
  const parent = findParent(environment);
  if (!token || !parent) {
    return null;
  }
  return {
    token,
    parent,
    titleProperty: findTrimmed(environment, 'NOTION_TITLE_PROPERTY') ?? DEFAULT_TITLE_PROPERTY,
  };
}
