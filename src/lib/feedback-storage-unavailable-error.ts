export class FeedbackStorageUnavailableError extends Error {
  constructor() {
    super('Feedback storage is unavailable.');
    this.name = 'FeedbackStorageUnavailableError';
  }
}
