import { describe, expect, it } from 'vitest';
import {
  areFeedbackAttachmentsAllowed as isAllowed, getGenericTargetLabel, isGenericTargetLabel, type CapturePolicy,
} from '@/lib/capture-policy';
import type { CreateFeedbackInput, ElementTarget, FlowEvent } from '@/types/feedback';

const ORIGIN = 'https://host.example';
const POLICY: CapturePolicy = { allowedPaths: ['/orders'], targets: [{ id: 'save-button', selector: 'button.save' }] };
const GENERIC: ElementTarget = {
  selector: 'body > main > ul > li:nth-of-type(2)', feedbackId: null, tagName: 'li', pagePath: '/orders',
  rect: { x: 1, y: 2, width: 80, height: 30 },
};
const NAMED: ElementTarget = { ...GENERIC, feedbackId: 'save-button', selector: 'button.save', tagName: 'button' };

function createInput(attachments: CreateFeedbackInput['attachments'], pageUrl = `${ORIGIN}/orders`): CreateFeedbackInput {
  return {
    projectKey: 'demo', hostOrigin: ORIGIN, message: 'Feedback', type: 'bug', reporter: { id: 'user-1', name: 'Demo User' },
    page: { url: pageUrl, title: 'Orders', viewportWidth: 390, viewportHeight: 844, userAgent: 'vitest' },
    attachments,
  };
}

function withComment(target: ElementTarget, pageUrl?: string): CreateFeedbackInput {
  return createInput({ comments: [{ target, comment: 'Feedback' }] }, pageUrl);
}

function withFlow(event: Omit<FlowEvent, 'offsetMs'>): CreateFeedbackInput {
  return createInput({ flow: {
    startedAt: '2026-11-12T12:00:00Z', endedAt: '2026-11-12T12:01:00Z', events: [{ offsetMs: 10, ...event }],
  } });
}

describe('generic capture targets', () => {
  it('accepts a structural selector on any page without a policy, and only on listed pages with one', () => {
    expect(isAllowed(withComment(GENERIC), null)).toBe(true);
    expect(isAllowed(withComment(GENERIC), POLICY)).toBe(true);
    expect(isAllowed(withComment({ ...GENERIC, pagePath: '/private' }), null)).toBe(true);
    expect(isAllowed(withComment({ ...GENERIC, pagePath: '/private' }), POLICY)).toBe(false);
  });

  it.each([
    ['an id', 'body > li#customer-42'],
    ['an attribute value', 'body > li[data-name="Kim"]'],
    ['a class', 'body > li.secret'],
    ['a descendant combinator', 'body li'],
    ['a zero position', 'body > li:nth-of-type(0)'],
    ['another tag', 'body > main > button'],
    ['more than 500 characters', `body > ${'div > '.repeat(100)}li`],
  ])('rejects a generic selector with %s', (_name, selector) => {
    expect(isAllowed(withComment({ ...GENERIC, selector }), null)).toBe(false);
  });

  it.each(['//evil.example/orders', '/orders?token=1', '/orders#section', 'orders'])('rejects the source page %s', (pagePath) => {
    expect(isAllowed(withComment({ ...GENERIC, pagePath }), null)).toBe(false);
  });

  it('rejects a page of another origin and keeps named targets strict', () => {
    expect(isAllowed(withComment(GENERIC, 'https://other.example/orders'), null)).toBe(false);
    expect(isAllowed(withComment(NAMED), POLICY)).toBe(true);
    expect(isAllowed(withComment(NAMED), null)).toBe(true);
    expect(isAllowed(withComment({ ...NAMED, selector: 'body > button' }), POLICY)).toBe(false);
  });

  it('accepts safe Flow labels without a policy and enforces explicitly configured labels', () => {
    expect(isAllowed(withFlow({ type: 'click', path: '/orders', targetLabel: 'button' }), null)).toBe(true);
    expect(isAllowed(withFlow({ type: 'input', path: '/orders', targetLabel: getGenericTargetLabel('x-date-picker') }), POLICY)).toBe(true);
    expect(isAllowed(withFlow({ type: 'navigation', path: '/orders/1', targetLabel: null, navigationType: 'spa' }), null)).toBe(true);
    expect(isAllowed(withFlow({ type: 'click', path: '/orders', targetLabel: 'private value' }), null)).toBe(false);
    expect(isAllowed(withFlow({ type: 'click', path: '/orders', targetLabel: 'private-value' }), POLICY)).toBe(false);
    expect(isAllowed(withFlow({ type: 'click', path: '/orders', targetLabel: 'save-button' }), null)).toBe(true);
    expect(isAllowed(withFlow({ type: 'click', path: '/orders?id=1', targetLabel: 'button' }), null)).toBe(false);
    expect(isAllowed(withFlow({ type: 'click', path: '/private', targetLabel: 'button' }), POLICY)).toBe(false);
    expect(isGenericTargetLabel('x-date-picker')).toBe(false);
  });
});
