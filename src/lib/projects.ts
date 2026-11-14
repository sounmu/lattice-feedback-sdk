import { resolveCapturePolicyFromJson, type CapturePolicy } from '@/lib/capture-policy';

export interface Project {
  projectKey: string;
  name: string;
  allowedOrigins: string[];
  adminToken: string | null;
  capturePolicy: CapturePolicy | null;
}

const DEMO_PROJECT_KEY = 'demo';
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:4000';
const DEVELOPMENT_ADMIN_TOKEN = 'dev-admin-token';

function getAllowedOrigins(): string[] {
  const rawValue = process.env.FEEDBACK_ALLOWED_ORIGINS;
  if (!rawValue) {
    return [DEFAULT_ALLOWED_ORIGIN];
  }
  const origins = rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0) {
    return [DEFAULT_ALLOWED_ORIGIN];
  }
  return origins;
}

function findAdminToken(): string | null {
  const configuredToken = process.env.FEEDBACK_ADMIN_TOKEN;
  if (configuredToken) {
    return configuredToken;
  }
  if (process.env.NODE_ENV !== 'production') {
    return DEVELOPMENT_ADMIN_TOKEN;
  }
  return null;
}

export function findProject(projectKey: string): Project | undefined {
  if (projectKey !== DEMO_PROJECT_KEY) {
    return undefined;
  }
  return {
    projectKey: DEMO_PROJECT_KEY,
    name: 'Demo project',
    allowedOrigins: getAllowedOrigins(),
    adminToken: findAdminToken(),
    capturePolicy: resolveCapturePolicyFromJson(process.env.FEEDBACK_CAPTURE_POLICY),
  };
}

export function isOriginAllowed(project: Project, origin: string): boolean {
  return project.allowedOrigins.includes(origin);
}
