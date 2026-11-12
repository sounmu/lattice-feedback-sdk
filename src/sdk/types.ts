import type { FeedbackReporter } from '@/types/feedback';
import type { InitMessage } from '@/types/sdk-message';
import type { CapturePolicy } from '@/lib/capture-policy';

export type FeedbackSdkInitOptions = Pick<InitMessage['payload'], 'projectKey'> & { capturePolicy?: CapturePolicy };

export interface LatticeFeedbackApi {
  init: (options: FeedbackSdkInitOptions) => void;
  setUser: (reporter: FeedbackReporter | null) => void;
  open: () => void;
  close: () => void;
  destroy: () => void;
}
