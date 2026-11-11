// Data minimization (AGENTS.md section 5): never collect query, hash, DOM, or input values here.
import type { PageContext } from '@/types/feedback';

export function getPageUrl(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

export function getPageContext(): PageContext {
  return {
    url: getPageUrl(window.location.href),
    title: document.title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    userAgent: navigator.userAgent,
  };
}
