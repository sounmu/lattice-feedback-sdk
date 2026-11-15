import type { MissingSnapshotAsset, ScreenSnapshotEvent } from '@/types/screen-snapshot';
import type { AutomaticMasker } from '@/sdk/automatic-masking';
import { isStaticIndexIncomplete } from '@/sdk/static-text-index';

export function getMaskingOmissions(masker: AutomaticMasker): MissingSnapshotAsset[] {
  if (masker.options.enabled === false) return [];
  const missing: MissingSnapshotAsset[] = [];
  if (masker.maskedValues > 0) {
    missing.push({ url: `${masker.maskedValues} text values / ${masker.maskedCharacters} characters`, reason: 'text_masked' });
  }
  if (isStaticIndexIncomplete()) missing.push({ url: 'Static text index', reason: 'text_index_incomplete' });
  return missing;
}

/** Safe counts travel with the event so a replay restored in a later document retains the notice. */
export function addMaskingReport(event: ScreenSnapshotEvent, masker: AutomaticMasker): void {
  if (typeof event.data !== 'object' || event.data === null) return;
  Object.assign(event.data, { latticeMasking: getMaskingOmissions(masker) });
  masker.maskedCharacters = 0;
  masker.maskedValues = 0;
}

export function getReplayMaskingOmissions(events: readonly ScreenSnapshotEvent[]): MissingSnapshotAsset[] {
  let characters = 0;
  let values = 0;
  let incomplete = false;
  for (const event of events) {
    if (typeof event.data !== 'object' || event.data === null || !('latticeMasking' in event.data)) continue;
    const entries = event.data.latticeMasking;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry?.url !== 'string' || (entry.reason !== 'text_masked' && entry.reason !== 'text_index_incomplete')) continue;
      if (entry.reason === 'text_index_incomplete') incomplete = true;
      const counts = /^(\d+) text values \/ (\d+) characters$/.exec(entry.url);
      if (entry.reason === 'text_masked' && counts) {
        values += Number(counts[1]);
        characters += Number(counts[2]);
      }
    }
  }
  const reports: MissingSnapshotAsset[] = [];
  if (values) reports.push({ url: `${values} text values / ${characters} characters`, reason: 'text_masked' });
  if (incomplete) reports.push({ url: 'Static text index', reason: 'text_index_incomplete' });
  return reports;
}
