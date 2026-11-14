/** The chosen original cannot be one: it is missing, in another project, the feedback itself, or already a duplicate. */
export class FeedbackDuplicateTargetError extends Error {
  constructor() {
    super('The original must be another feedback of this project that is not a duplicate.');
    this.name = 'FeedbackDuplicateTargetError';
  }
}
