import { z } from 'zod';
import { MAX_THREAD_MESSAGE_LENGTH, MAX_THREAD_MESSAGES } from '@/lib/conversation';

export const reporterIdentitySchema = z.object({
  expiresAt: z.number().int().positive(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export const conversationMessagesSchema = z.array(z.object({
  id: z.string().min(1),
  authorRole: z.enum(['reporter', 'admin', 'sdk', 'ai']),
  body: z.string().min(1).max(MAX_THREAD_MESSAGE_LENGTH),
  createdAt: z.iso.datetime({ offset: true }),
})).max(MAX_THREAD_MESSAGES);

export const conversationRequestSchema = z.object({
  projectKey: z.string().min(1).max(200),
  hostOrigin: z.string().max(2048),
  reporter: z.object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    identity: reporterIdentitySchema.optional(),
  }).nullable(),
  secrets: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100),
}).strict();

export const conversationPostSchema = conversationRequestSchema.extend({
  feedbackId: z.uuid(),
  message: z.string().trim().min(1).max(MAX_THREAD_MESSAGE_LENGTH),
}).strict();
