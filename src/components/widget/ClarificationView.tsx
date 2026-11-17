'use client';

import { useState, type ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';

import { ChoiceChips } from '@/components/widget/ChoiceChips';
import { WIDGET_TEAM_NAME, WidgetBody, WidgetFooter, WidgetHeader } from '@/components/widget/WidgetLayout';
import {
  CUSTOM_CLARIFICATION_CHOICE, EMPTY_CLARIFICATION_CHOICE, getClarificationAnswer, type ClarificationChoice,
} from '@/lib/clarification-answers';
import { MAX_CLARIFICATION_ANSWER_LENGTH } from '@/lib/clarification-limits';
import type { ClarificationQuestion } from '@/types/feedback';

const CUSTOM_ANSWER_LABEL = '직접 입력';

interface ClarificationViewProps {
  questions: ClarificationQuestion[];
  isBusy: boolean;
  /** Banners about sending, shown above the buttons. */
  status: ReactNode;
  onSend: (choices: ClarificationChoice[]) => void;
  onBack: () => void;
  onClose: () => void;
}

// The AI's questions, asked in the chat before the feedback is sent. Every question can be left alone, and
// the reporter can always send without answering.
export function ClarificationView({ questions, isBusy, status, onSend, onBack, onClose }: ClarificationViewProps) {
  const [choices, setChoices] = useState<ClarificationChoice[]>(() => questions.map(() => EMPTY_CLARIFICATION_CHOICE));
  const hasAnswer = questions.some((question, index) => getClarificationAnswer(question, choices[index]) !== null);

  function updateChoice(index: number, change: Partial<ClarificationChoice>) {
    setChoices((current) => current.map((choice, position) => (position === index ? { ...choice, ...change } : choice)));
  }

  return (
    <>
      <WidgetHeader title="조금만 더 알려 주세요" subtitle="답하지 않아도 보낼 수 있어요" onBack={isBusy ? undefined : onBack} backLabel="작성 화면으로 돌아가기" onClose={onClose} />
      <WidgetBody>
        <ChatMessage sender="assistant" avatar={<Avatar name={WIDGET_TEAM_NAME} size="sm" shape="rounded" tooltip={false} />} name={null}>
          <ChatMessageBubble group="first">
            <Text as="p">보내기 전에 {questions.length === 1 ? '하나만' : '두 가지만'} 여쭤볼게요. 담당자가 다시 묻지 않아도 되도록 도와주세요.</Text>
          </ChatMessageBubble>
          {questions.map((question, index) => {
            const choice = choices[index];
            const options = [
              ...question.options.map((option, optionIndex) => ({ value: String(optionIndex), label: option })),
              { value: CUSTOM_CLARIFICATION_CHOICE, label: CUSTOM_ANSWER_LABEL },
            ];
            return (
              <ChatMessageBubble key={question.question} group={index === questions.length - 1 ? 'last' : 'middle'}>
                <VStack gap={2}>
                  <Text as="p" weight="semibold">{question.question}</Text>
                  <ChoiceChips
                    label={question.question}
                    options={options}
                    value={choice.selected}
                    onChange={(selected) => updateChoice(index, { selected })}
                    isDisabled={isBusy}
                  />
                  {choice.selected === CUSTOM_CLARIFICATION_CHOICE ? (
                    <TextArea
                      label="직접 입력한 답"
                      aria-label="직접 입력한 답"
                      isLabelHidden
                      placeholder="편하게 적어 주세요"
                      rows={2}
                      value={choice.customText}
                      htmlMaxLength={MAX_CLARIFICATION_ANSWER_LENGTH}
                      isDisabled={isBusy}
                      onChange={(customText) => updateChoice(index, { customText })}
                    />
                  ) : null}
                </VStack>
              </ChatMessageBubble>
            );
          })}
        </ChatMessage>
      </WidgetBody>
      <WidgetFooter>
        {status}
        <HStack gap={2}>
          <Button
            label="건너뛰고 보내기"
            size="lg"
            width="100%"
            isDisabled={isBusy}
            onClick={() => onSend(questions.map(() => EMPTY_CLARIFICATION_CHOICE))}
            data-autofocus=""
          />
          <Button label="답하고 보내기" variant="primary" size="lg" width="100%" isDisabled={isBusy || !hasAnswer} onClick={() => onSend(choices)} />
        </HStack>
      </WidgetFooter>
    </>
  );
}
