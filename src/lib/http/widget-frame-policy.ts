import { findProject } from '@/lib/projects';

// A disallowed site must not be able to embed the widget and submit through it.
export function getWidgetFrameAncestorsPolicy(projectKey: string | null): string {
  const project = projectKey ? findProject(projectKey) : undefined;
  if (!project || project.allowedOrigins.length === 0) {
    return "frame-ancestors 'none'";
  }
  return `frame-ancestors ${project.allowedOrigins.join(' ')}`;
}
