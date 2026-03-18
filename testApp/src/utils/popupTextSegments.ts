import { parseInterestingTextSegments } from './interestingTextSegments';

export type PopupTextSegment =
  | { type: 'text'; content: string }
  | { type: 'citation'; content: string; numbers: string[] }
  | { type: 'url'; content: string; href: string };

export function parsePopupTextSegments(text: string): PopupTextSegment[] {
  return parseInterestingTextSegments(text).map((segment) => {
    if (segment.type === 'text') {
      return segment;
    }

    if (segment.entity.kind === 'url') {
      return {
        type: 'url',
        content: segment.entity.content,
        href: segment.entity.href
      };
    }

    return {
      type: 'citation',
      content: segment.entity.content,
      numbers: segment.entity.numbers
    };
  });
}
