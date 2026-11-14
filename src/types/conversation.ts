export interface ReporterSignature {
  expiresAt: number;
  signature: string;
}

export interface ConversationMessage {
  id: string;
  authorRole: 'reporter' | 'admin' | 'sdk' | 'ai';
  body: string;
  createdAt: string;
}

/** Server-only credentials. Never included in feedback responses. */
export interface ConversationAccess {
  browserSecretHash: string;
  verifiedReporterId: string | null;
}

export interface ConversationCredentials {
  browserSecretHashes: string[];
  verifiedReporterId: string | null;
}
