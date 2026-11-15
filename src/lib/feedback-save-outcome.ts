export interface SaveOutcome {
  /** The server stored the change. This holds whichever feedback is selected when the response arrives. */
  isAccepted: boolean;
  /** The response belongs to the request the page still shows, so its detail may replace what is displayed. */
  shouldShowDetail: boolean;
}

export function findSaveOutcome(isAccepted: boolean, savedRequestKey: string, currentRequestKey: string): SaveOutcome {
  return { isAccepted, shouldShowDetail: isAccepted && savedRequestKey === currentRequestKey };
}
