// Limits for the questions the AI asks before a feedback is sent. Shared by the widget, the validation and
// the model client, so a question the server accepts always fits the widget.
export const MAX_CLARIFICATION_QUESTIONS = 2;
export const MIN_CLARIFICATION_OPTIONS = 2;
export const MAX_CLARIFICATION_OPTIONS = 4;
export const MAX_CLARIFICATION_QUESTION_LENGTH = 200;
export const MAX_CLARIFICATION_OPTION_LENGTH = 60;
export const MAX_CLARIFICATION_ANSWER_LENGTH = 500;
export const MAX_CLARIFICATION_MODEL_LENGTH = 120;
