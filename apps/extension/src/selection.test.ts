// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { captureSelection } from './selection';

beforeAll(() => { Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 40, 18); });
afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

function select(start: Node, startOffset: number, end: Node = start, endOffset = startOffset + 3) {
  const range = document.createRange();
  range.setStart(start, startOffset); range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  return captureSelection(selection);
}

describe('selection snapshots', () => {
  it('takes the actual second occurrence instead of the first matching word', () => {
    document.body.innerHTML = '<p>I buy books. I do not buy that argument.</p>';
    const node = document.querySelector('p')!.firstChild!;
    const offset = node.textContent!.lastIndexOf('buy');
    expect(select(node, offset)?.sentence).toBe('I do not buy that argument.');
  });

  it('joins selections crossing inline markup and normalizes whitespace', () => {
    document.body.innerHTML = '<p>Earlier sentence. We <strong>look</strong>\n through <em>the code</em> together. Later sentence.</p>';
    const start = document.querySelector('strong')!.firstChild!;
    const end = document.querySelector('em')!.previousSibling!;
    const captured = select(start, 0, end, '\n through'.length)!;
    expect(captured.selection).toBe('look through');
    expect(captured.sentence).toBe('We look through the code together.');
  });

  it('keeps every sentence touched by a multi-sentence selection', () => {
    document.body.innerHTML = '<p>First thought. Another thought. Final thought.</p>';
    const node = document.querySelector('p')!.firstChild!;
    const captured = select(node, 6, node, 21)!;
    expect(captured.sentence).toBe('First thought. Another thought.');
  });

  it('retains a late selection when the paragraph exceeds the context limit', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Earlier material. '.repeat(1200) + 'We reconsider the tradeoff now.';
    document.body.append(paragraph);
    const node = paragraph.firstChild!;
    const offset = node.textContent!.lastIndexOf('tradeoff');
    const captured = select(node, offset, node, offset + 8)!;
    expect(captured.sentence).toBe('We reconsider the tradeoff now.');
    expect(captured.context).toContain('tradeoff');
    expect(captured.context.length).toBeLessThanOrEqual(16000);
  });

  it('ignores editable fields and the extension overlay', () => {
    document.body.innerHTML = '<div contenteditable="true">draft</div><div data-sayseed-overlay>private</div>';
    expect(select(document.body.children[0]!.firstChild!, 0)).toBeNull();
    expect(select(document.body.children[1]!.firstChild!, 0)).toBeNull();
  });
});
