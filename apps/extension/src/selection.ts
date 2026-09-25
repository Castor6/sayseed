export interface CapturedSelection { selection: string; sentence: string; context: string; rect: DOMRect }

const normalize = (value: string) => value.replace(/\s+/g, ' ');

function excerpt(text: string, start: number, end: number, limit: number): string {
  if (text.length <= limit) return text.trim();
  const left = Math.max(0, Math.min(start - Math.floor((limit - (end - start)) / 2), text.length - limit));
  return text.slice(left, left + limit).trim();
}

export function captureSelection(selection: Selection | null, options: { allowEditable?: boolean } = {}): CapturedSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : container.parentElement;
  if (!element || element.closest('input, textarea, [data-sayseed-overlay], script, style, nav, button')) return null;
  if (!options.allowEditable && element.closest('[contenteditable]')) return null;
  const selectedRaw = range.toString();
  const selected = normalize(selectedRaw).trim();
  if (!selected || selected.length > 2000 || !/[A-Za-z]/.test(selected)) return null;
  let block = element;
  while (block.parentElement && !/^(P|LI|BLOCKQUOTE|FIGCAPTION|H[1-6]|ARTICLE|DIV)$/i.test(block.tagName)) block = block.parentElement;

  // Range offsets preserve which occurrence was selected, including across inline elements.
  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const whole = document.createRange();
  whole.selectNodeContents(block);
  const raw = whole.toString();
  const rawStart = prefix.toString().length + selectedRaw.length - selectedRaw.trimStart().length;
  const start = normalize(raw.slice(0, rawStart)).trimStart().length;
  const text = normalize(raw).trim();
  const end = start + selected.length;

  let sentenceStart = 0, sentenceEnd = text.length;
  const segments = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)];
  const covered = segments.filter(segment => segment.index < end && segment.index + segment.segment.length > start);
  if (covered.length) {
    sentenceStart = covered[0]!.index;
    const last = covered[covered.length - 1]!;
    sentenceEnd = last.index + last.segment.length;
  }
  const sentence = excerpt(text.slice(sentenceStart, sentenceEnd), start - sentenceStart, end - sentenceStart, 12000);
  return {
    selection: selected,
    sentence: sentence.includes(selected) ? sentence : selected,
    context: excerpt(text, start, end, 16000),
    rect: range.getBoundingClientRect(),
  };
}
