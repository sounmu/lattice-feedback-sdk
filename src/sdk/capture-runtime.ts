// Everything the SDK needs only once the reporter opens the widget or a Flow is being recorded: the
// Comment, Edit and Flow tools, the saved-screen serializer, automatic masking and the large preview.
// scripts/build-sdk.mjs builds this module into a file of its own, and sdk.js imports that file through
// src/sdk/runtime-loader.ts. A module with state, such as the static text index, has to be reached through
// here: bundled into sdk.js as well, it would exist twice.
export { CapturePageChangedError, CapturePageNotAllowedError } from '@/sdk/capture-guard';
export { createCaptureController } from '@/sdk/capture-controller';
export { createPreviewPanel } from '@/sdk/preview-panel';
export { captureRecording, captureScreen } from '@/sdk/screen-capture';
export {
  configureAutomaticMasking, createAutomaticMasker, onStaticIndexSettled, prepareStaticTextIndex, warmStaticTextIndex,
} from '@/sdk/static-text-index';
