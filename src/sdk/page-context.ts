// Data minimization (AGENTS.md section 5): never collect query, hash, DOM, or input values here.
import { MAX_PAGE_TITLE_LENGTH, MAX_USER_AGENT_LENGTH, truncateText } from '@/lib/feedback-limits';
import type { PageContext } from '@/types/feedback';
import { createAutomaticMasker } from '@/sdk/static-text-index';

export function getPageUrl(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

export function getPageContext(): PageContext {
  return {
    url: getPageUrl(window.location.href),
    title: truncateText(createAutomaticMasker().text(document.title), MAX_PAGE_TITLE_LENGTH),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    userAgent: truncateText(navigator.userAgent, MAX_USER_AGENT_LENGTH),
  };
}
