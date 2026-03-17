import {
  buildViewportPriorityPageOrder,
  selectNextPendingBackgroundPage
} from '../testApp/src/utils/backgroundPageScheduling';

describe('background page scheduling', () => {
  it('keeps rendering in ascending order when there is no viewport hint', () => {
    expect(selectNextPendingBackgroundPage(new Set([9, 6, 12, 8]), [])).toBe(6);
  });

  it('prioritizes visible pages before the default ascending queue', () => {
    expect(selectNextPendingBackgroundPage(new Set([6, 7, 30, 31]), [30, 31, 32])).toBe(30);
  });

  it('builds a compact priority window around the visible page range', () => {
    expect(buildViewportPriorityPageOrder([4, 30, 31], 40)).toEqual([30, 31, 32, 33, 34, 29, 28]);
  });
});
