import { Card } from '@astryxdesign/core/Card';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';

import { WidgetBody, WidgetHeader } from '@/components/widget/WidgetLayout';

const TITLE = '피드백 보내기';
const LOADING_LABEL = '준비하는 중이에요';
const LOADING_LINE_WIDTHS = ['80%', '60%', '66%'];

/**
 * What the widget frame shows until its scripts have run. It is part of the page's HTML, so it paints as
 * soon as the stylesheet has loaded instead of after the scripts. It repeats the header and loading lines
 * FeedbackWidget shows while it waits for the host page, so nothing moves when the widget takes over.
 */
export function WidgetSkeleton() {
  return (
    <div lang="ko" className="widget-root flex h-dvh flex-col overflow-hidden">
      <WidgetHeader title={TITLE} subtitle={`${LOADING_LABEL}…`} />
      <WidgetBody>
        <div role="status" aria-label={LOADING_LABEL}>
          <Card padding={3}>
            <VStack gap={2}>
              {LOADING_LINE_WIDTHS.map((width, index) => (
                <Skeleton key={width} height={12} width={width} index={index} />
              ))}
            </VStack>
          </Card>
        </div>
      </WidgetBody>
    </div>
  );
}
