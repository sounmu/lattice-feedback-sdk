export class FeedbackStorageFullError extends Error {
  constructor() {
    super('Feedback storage is full.');
    this.name = 'FeedbackStorageFullError';
  }
}
