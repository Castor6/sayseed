// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorText, replaceEditorText } from './x-editor';

// These fixtures simulate controlled paste handling, not a running Draft.js editor.
class TestDataTransfer {
  private data = new Map<string, string>();
  get types() { return [...this.data.keys()]; }
  setData(type: string, value: string) { this.data.set(type, value); }
  getData(type: string) { return this.data.get(type) || ''; }
}
class TestClipboardEvent extends Event {
  readonly clipboardData: DataTransfer | null;
  constructor(type: string, init: ClipboardEventInit) {
    super(type, init);
    this.clipboardData = init.clipboardData || null;
  }
}

function renderText(editor: HTMLElement, text: string) {
  const contents = document.createElement('div');
  contents.dataset.contents = 'true';
  for (const [index, line] of text.split('\n').entries()) {
    const block = document.createElement('div');
    block.dataset.block = 'true';
    block.dataset.offsetKey = `block${index}-0-0`;
    const style = document.createElement('div');
    style.className = 'public-DraftStyleDefault-block';
    const leaf = document.createElement('span');
    leaf.dataset.offsetKey = block.dataset.offsetKey;
    const node = document.createElement(line ? 'span' : 'br');
    node.dataset.text = 'true';
    node.textContent = line;
    leaf.append(node); style.append(leaf); block.append(style); contents.append(block);
  }
  editor.replaceChildren(contents);
}

// Each entry is a block's raw rendered leaf text, including any Draft sentinel.
function renderLeaves(editor: HTMLElement, blocks: string[][]) {
  renderText(editor, blocks.map(() => 'placeholder').join('\n'));
  [...editor.querySelectorAll('.public-DraftStyleDefault-block')].forEach((style, blockIndex) => {
    style.replaceChildren(...blocks[blockIndex]!.map((raw, leafIndex) => {
      const leaf = document.createElement('span');
      leaf.dataset.offsetKey = `block${blockIndex}-0-${leafIndex}`;
      const node = document.createElement('span');
      node.dataset.text = 'true';
      node.textContent = raw;
      leaf.append(node);
      return leaf;
    }));
  });
}

let editor: HTMLElement;
let execCommand: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('DataTransfer', TestDataTransfer);
  vi.stubGlobal('ClipboardEvent', TestClipboardEvent);
  execCommand = vi.fn(() => { throw new Error('execCommand must not be used'); });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  editor = document.createElement('div');
  editor.className = 'public-DraftEditor-content';
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  renderText(editor, '中文原稿');
  document.body.append(editor);
});
afterEach(() => {
  expect(execCommand).not.toHaveBeenCalled();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function acceptPaste(transform: (text: string) => string = text => text) {
  const handler = vi.fn((event: Event) => {
    event.preventDefault();
    renderText(editor, transform((event as ClipboardEvent).clipboardData!.getData('text/plain')));
  });
  editor.addEventListener('paste', handler);
  return handler;
}

it('pastes only plain text with multiple paragraphs and blank lines through the controlled handler', async () => {
  const handler = acceptPaste();
  const translation = 'First paragraph.\n\nSecond <b>literal</b> paragraph.\n\nLast paragraph.';
  const result = replaceEditorText(editor, '中文原稿', translation);
  await vi.advanceTimersByTimeAsync(140);
  expect(await result).toBe('applied');
  expect(editorText(editor)).toBe(translation);
  expect(editor.querySelector('b')).toBeNull();
  expect(editor.querySelectorAll('[data-block]')).toHaveLength(5);
  expect(handler).toHaveBeenCalledTimes(1);
  const event = handler.mock.calls[0]![0] as ClipboardEvent;
  expect(event.clipboardData!.types).toEqual(['text/plain']);
  expect(event.clipboardData!.getData('text/html')).toBe('');
  expect(event.bubbles && event.cancelable && event.composed).toBe(true);
});

it('waits for focus and full selection to settle before sending paste', async () => {
  renderText(editor, '第一段\n\n最后一段');
  const handler = acceptPaste();
  const result = replaceEditorText(editor, editorText(editor), 'Translation');
  expect(handler).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(20);
  expect(handler).not.toHaveBeenCalled();
  const range = document.getSelection()!.getRangeAt(0);
  const leaves = editor.querySelectorAll('[data-text]');
  expect(range.startContainer).toBe(leaves[0]!.firstChild);
  expect(range.startOffset).toBe(0);
  expect(range.endContainer).toBe(leaves[2]!.firstChild);
  expect(range.endOffset).toBe(4);
  await vi.advanceTimersByTimeAsync(19);
  expect(handler).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(handler).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toBe('applied');
});

it('rejects corrupted paragraphs sharing one block and offset key without mutating them', async () => {
  const block = editor.querySelector('[data-block]')!;
  block.append(block.firstElementChild!.cloneNode(true));
  const before = editor.innerHTML;
  const handler = acceptPaste();
  expect(await replaceEditorText(editor, editorText(editor), 'Translation')).toBe('unsupported');
  expect(editor.innerHTML).toBe(before);
  expect(handler).not.toHaveBeenCalled();
});

it('does not insert text or retry when no controlled handler accepts paste', async () => {
  const before = editor.innerHTML;
  const listener = vi.fn();
  editor.addEventListener('paste', listener);
  const result = replaceEditorText(editor, '中文原稿', 'Translation');
  await vi.advanceTimersByTimeAsync(40);
  expect(await result).toBe('unsupported');
  await vi.advanceTimersByTimeAsync(2000);
  expect(editor.innerHTML).toBe(before);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('reports an incomplete handler result as unverified without automatically retrying', async () => {
  const handler = acceptPaste(text => text.split('\n').at(-1)!);
  const result = replaceEditorText(editor, '中文原稿', 'First\n\nLast');
  await vi.advanceTimersByTimeAsync(1040);
  expect(await result).toBe('unverified');
  await vi.advanceTimersByTimeAsync(2000);
  expect(editorText(editor)).toBe('Last');
  expect(handler).toHaveBeenCalledTimes(1);
});

it.each(['snapshot', 'target', 'abort', 'selection', 'detached'] as const)('blocks paste if %s changes during selection settling', async change => {
  const handler = acceptPaste();
  let current = true;
  const controller = new AbortController();
  const result = replaceEditorText(editor, '中文原稿', 'Translation', { isCurrent: () => current, signal: controller.signal });
  await vi.advanceTimersByTimeAsync(20);
  if (change === 'snapshot') renderText(editor, '用户修改');
  if (change === 'target') current = false;
  if (change === 'abort') controller.abort();
  if (change === 'selection') document.getSelection()!.removeAllRanges();
  if (change === 'detached') editor.remove();
  await vi.advanceTimersByTimeAsync(20);
  expect(await result).toBe('conflict');
  expect(handler).not.toHaveBeenCalled();
  expect(editorText(editor)).toBe(change === 'snapshot' ? '用户修改' : '中文原稿');
});

it('rejects an outdated initial snapshot before touching focus or dispatching paste', async () => {
  const handler = acceptPaste();
  const focus = vi.spyOn(editor, 'focus');
  expect(await replaceEditorText(editor, '旧稿', 'Translation')).toBe('conflict');
  expect(focus).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

it('serializes replacements per editor and releases the lock after completion', async () => {
  const handler = acceptPaste();
  const first = replaceEditorText(editor, '中文原稿', 'First');
  expect(await replaceEditorText(editor, '中文原稿', 'Second')).toBe('conflict');
  await vi.advanceTimersByTimeAsync(140);
  expect(await first).toBe('applied');
  const next = replaceEditorText(editor, 'First', 'Second');
  await vi.advanceTimersByTimeAsync(140);
  expect(await next).toBe('applied');
  expect(handler).toHaveBeenCalledTimes(2);
  expect(editorText(editor)).toBe('Second');
});

it('stops before paste if a user starts editing while selection settles', async () => {
  const handler = acceptPaste();
  const result = replaceEditorText(editor, '中文原稿', 'Translation');
  await vi.advanceTimersByTimeAsync(20);
  editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: '新' }));
  await vi.advanceTimersByTimeAsync(20);
  expect(await result).toBe('conflict');
  expect(handler).not.toHaveBeenCalled();
});

it('stops verification without retrying or overwriting user input after paste', async () => {
  const handler = acceptPaste();
  const result = replaceEditorText(editor, '中文原稿', 'Translation');
  await vi.advanceTimersByTimeAsync(40);
  editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: '!' }));
  renderText(editor, 'Translation!');
  await vi.advanceTimersByTimeAsync(20);
  expect(await result).toBe('unverified');
  await vi.advanceTimersByTimeAsync(2000);
  expect(editorText(editor)).toBe('Translation!');
  expect(handler).toHaveBeenCalledTimes(1);
});

it('accepts internal soft line breaks in one plain-text leaf when replacing the draft', async () => {
  const draft = '第一段\n第二段\n\n末段';
  renderLeaves(editor, [[draft]]);
  const handler = acceptPaste();
  const result = replaceEditorText(editor, draft, 'Complete translation');
  await vi.advanceTimersByTimeAsync(140);
  expect(await result).toBe('applied');
  expect(handler).toHaveBeenCalledTimes(1);
  expect(editorText(editor)).toBe('Complete translation');
});

it('verifies a controlled paste handler that renders soft lines inside one leaf', async () => {
  const translation = 'First line\nSecond line\n\nLast line';
  editor.addEventListener('paste', event => {
    event.preventDefault();
    renderLeaves(editor, [[(event as ClipboardEvent).clipboardData!.getData('text/plain')]]);
  });
  const result = replaceEditorText(editor, '中文原稿', translation);
  await vi.advanceTimersByTimeAsync(140);
  expect(await result).toBe('applied');
  expect(editorText(editor)).toBe(translation);
  expect(editor.querySelectorAll('[data-block]')).toHaveLength(1);
});

it.each(['\n', '\n\n'])('preserves trailing %j in a non-final leaf as actual soft breaks', async lineBreaks => {
  renderLeaves(editor, [[`First${lineBreaks}`, 'Last']]);
  const expected = `First${lineBreaks}Last`;
  expect(editorText(editor)).toBe(expected);
  const handler = acceptPaste();
  const result = replaceEditorText(editor, expected, 'Translation');
  await vi.advanceTimersByTimeAsync(140);
  expect(await result).toBe('applied');
  expect(handler).toHaveBeenCalledTimes(1);
});

it.each([1, 3])('excludes exactly one sentinel from the UTF-16 selection after %i trailing soft breaks', async breakCount => {
  const text = `结尾😀${'\n'.repeat(breakCount)}`;
  renderLeaves(editor, [[`${text}\n`]]);
  const leafText = editor.querySelector('[data-text]')!.firstChild;
  const handler = acceptPaste();
  const result = replaceEditorText(editor, text, 'Translation');
  await vi.advanceTimersByTimeAsync(20);
  const range = document.getSelection()!.getRangeAt(0);
  expect(range.startContainer).toBe(leafText);
  expect(range.startOffset).toBe(0);
  expect(range.endContainer).toBe(leafText);
  expect(range.endOffset).toBe(text.length);
  expect(range.toString()).toBe(text);
  await vi.advanceTimersByTimeAsync(120);
  expect(await result).toBe('applied');
  expect(handler).toHaveBeenCalledTimes(1);
});

it('removes the rendered sentinel from intermediate blocks without adding an extra blank line', async () => {
  renderLeaves(editor, [['First\n\n'], ['Middle\n\n\n'], ['Last']]);
  const expected = 'First\n\nMiddle\n\n\nLast';
  expect(editorText(editor)).toBe(expected);
  const handler = acceptPaste();
  const result = replaceEditorText(editor, expected, 'Translation');
  await vi.advanceTimersByTimeAsync(140);
  expect(await result).toBe('applied');
  expect(handler).toHaveBeenCalledTimes(1);
});

it('locates the logical selection endpoint across split text nodes before the sentinel', async () => {
  const text = '中文🌱\n';
  renderLeaves(editor, [[`${text}\n`]]);
  const node = editor.querySelector('[data-text]')!;
  const parts = ['中文', '🌱', '\n\n'].map(part => document.createTextNode(part));
  node.replaceChildren(...parts);
  acceptPaste();
  const result = replaceEditorText(editor, text, 'Translation');
  await vi.advanceTimersByTimeAsync(20);
  const range = document.getSelection()!.getRangeAt(0);
  expect(range.endContainer).toBe(parts[2]);
  expect(range.endOffset).toBe(1);
  expect(range.toString()).toBe(text);
  await vi.advanceTimersByTimeAsync(120);
  expect(await result).toBe('applied');
});

it.each(['nested element', 'duplicate block key', 'carriage return'])('still rejects %s after allowing soft lines', async corruption => {
  if (corruption === 'nested element') {
    const node = editor.querySelector('[data-text]')!;
    const nested = document.createElement('span');
    nested.textContent = node.textContent;
    node.replaceChildren(nested);
  } else if (corruption === 'duplicate block key') {
    const block = editor.querySelector('[data-block]')!;
    block.parentElement!.append(block.cloneNode(true));
  } else {
    renderLeaves(editor, [['First\rLast']]);
  }
  const before = editor.innerHTML;
  const handler = acceptPaste();
  expect(await replaceEditorText(editor, editorText(editor), 'Translation')).toBe('unsupported');
  expect(editor.innerHTML).toBe(before);
  expect(handler).not.toHaveBeenCalled();
});
