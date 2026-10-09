// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyContext, type TranslateInput, type TranslationEvent } from '@sayseed/shared';

const calls = vi.hoisted(() => ({ inputs: [] as TranslateInput[], handlers: [] as ((event: TranslationEvent) => void)[] }));
vi.mock('./api', () => ({
  models: async () => [],
  translate: (input: TranslateInput, handler: (event: TranslationEvent) => void) => { calls.inputs.push(input); calls.handlers.push(handler); return { cancel: vi.fn() }; },
  explain: vi.fn(), saveNote: vi.fn(),
}));
import { XAssistant } from './x-ui';
import { replaceEditorText } from './x-dom';
vi.mock('./x-dom', async importOriginal => ({ ...await importOriginal<typeof import('./x-dom')>(), replaceEditorText: vi.fn() }));
const replaceMock = vi.mocked(replaceEditorText);

let root: Root;
let editor: HTMLElement;
let holder: HTMLElement;
let current: boolean;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  replaceMock.mockReset();
  replaceMock.mockImplementation(async (target, expected, next, options) => {
    if (options?.signal?.aborted || options?.isCurrent?.() === false || target.textContent !== expected) return 'conflict';
    target.textContent = next;
    return 'applied';
  });
  calls.inputs.length = 0; calls.handlers.length = 0; current = true;
  editor = document.createElement('div'); editor.contentEditable = 'true'; editor.textContent = '我还没试过';
  holder = document.createElement('div'); document.body.append(editor, holder);
  root = createRoot(holder);
  await act(async () => root.render(<XAssistant editor={editor} initialContext={emptyContext()} isCurrent={() => current} onClose={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function button(label: string) { return [...holder.querySelectorAll('button')].find(node => node.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function finish(event: TranslationEvent = { type: 'done', text: "I haven't tried it yet.", kind: 'translation' }) {
  await act(async () => calls.handlers.at(-1)!(event));
}

it('preserves the undo snapshot when the same result is adopted twice', async () => {
  await finish(); await click('采用'); await click('采用'); await click('撤回');
  expect(editor.textContent).toBe('我还没试过');
});

it('undo uses the adopted text even if the assistant result is subsequently edited', async () => {
  await finish(); await click('采用');
  const output = holder.querySelector<HTMLElement>('.output')!;
  await act(async () => { output.innerText = 'Edited English.'; output.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await click('撤回');
  expect(editor.textContent).toBe('我还没试过');
});

it('blocks adopting into a changed draft or changed target', async () => {
  await finish(); editor.textContent = '另一份中文'; await click('采用');
  expect(editor.textContent).toBe('另一份中文');
  editor.textContent = '我还没试过'; current = false; await click('采用');
  expect(editor.textContent).toBe('我还没试过');
});

it('clears old output and prevents adopting a failed or clarification response', async () => {
  await finish(); await click('重新生成');
  await finish({ type: 'error', message: 'Failed' });
  expect(button('采用').disabled).toBe(true);
  await click('翻译'); await finish({ type: 'done', text: '你想表达哪种意思？', kind: 'clarification' });
  expect(button('采用').disabled).toBe(true);
});

it('retains the Chinese source for another generation after adopting English', async () => {
  await finish(); await click('采用'); await click('重新生成');
  expect(calls.inputs.at(-1)?.draft).toBe('我还没试过');
});

it('retains the original source when the adopted result has surrounding whitespace or CRLF', async () => {
  await finish({ type: 'done', text: '  First line.\r\n\r\nSecond line.\n', kind: 'translation' });
  await click('采用');
  expect(editor.textContent).toBe('First line.\n\nSecond line.');
  await click('采用');
  expect(replaceMock).toHaveBeenCalledTimes(1);
  await click('重新生成');
  expect(calls.inputs.at(-1)?.draft).toBe('我还没试过');
});

it('shows text-only context controls without an image preview or removal action', async () => {
  await act(async () => root.unmount());
  root = createRoot(holder);
  await act(async () => root.render(<XAssistant editor={editor} initialContext={{
    ...emptyContext(), mode: 'reply', target: { text: '', images: ['https://pbs.twimg.com/media/photo.jpg'] },
  }} isCurrent={() => current} onClose={() => {}} />));
  await click('查看上下文');
  expect(holder.textContent).toContain('翻译只参考帖子文字；图片不会发送给模型。');
  expect(holder.textContent).toContain('这条帖子只有图片');
  expect(holder.querySelector('.context img')).toBeNull();
  expect([...holder.querySelectorAll('button')].some(node => node.textContent?.includes('移除图片'))).toBe(false);
});

it('drags the assistant by its title without moving when the close button is pressed', async () => {
  const panel = holder.querySelector<HTMLElement>('.panel')!;
  const handle = holder.querySelector<HTMLElement>('.drag-handle')!;
  const before = Number.parseFloat(panel.style.left);
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: 20 } });
    return event;
  };
  await act(async () => {
    handle.dispatchEvent(pointer('pointerdown', 20));
    handle.dispatchEvent(pointer('pointermove', 180));
    handle.dispatchEvent(pointer('pointerup', 180));
  });
  expect(Number.parseFloat(panel.style.left)).toBeGreaterThan(before);
  const afterDrag = panel.style.left;
  await act(async () => window.dispatchEvent(new Event('scroll')));
  expect(panel.style.left).toBe(afterDrag);
  await act(async () => {
    button('关闭').dispatchEvent(pointer('pointerdown', 20));
    handle.dispatchEvent(pointer('pointermove', 300));
  });
  expect(panel.style.left).toBe(afterDrag);
});

function pendingReplacement() {
  let resolve!: (result: 'applied' | 'conflict' | 'unsupported' | 'unverified') => void;
  replaceMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  return (result: 'applied' | 'conflict' | 'unsupported' | 'unverified') => act(async () => resolve(result));
}

it('locks replacement synchronously and only enables undo after verification', async () => {
  await finish();
  const complete = pendingReplacement();
  await act(async () => { button('采用').click(); button('采用').click(); });
  expect(replaceMock).toHaveBeenCalledTimes(1);
  expect(holder.textContent).toContain('正在验证');
  expect(button('撤回')).toBeUndefined();
  expect(button('采用').disabled).toBe(true);
  expect(button('重新生成').disabled).toBe(true);
  expect(button('按要求修改').disabled).toBe(true);
  expect(holder.querySelector('.output')?.getAttribute('contenteditable')).toBe('false');
  expect(holder.querySelector('select')?.disabled).toBe(true);
  await complete('applied');
  expect(button('撤回').disabled).toBe(false);
  expect(holder.textContent).toContain('已回填到 X');
});

it.each(['unsupported', 'unverified', 'conflict'] as const)('does not mark %s replacement as adopted', async result => {
  await finish();
  replaceMock.mockResolvedValueOnce(result);
  await click('采用');
  expect(button('撤回')).toBeUndefined();
  expect(holder.textContent).not.toContain('已回填到 X');
  if (result !== 'conflict') expect(holder.textContent).toContain('全选并重新粘贴');
  await click('采用');
  expect(replaceMock.mock.calls[1]?.[1]).toBe('我还没试过');
});

it('keeps undo available when undo verification fails', async () => {
  await finish(); await click('采用');
  const complete = pendingReplacement();
  await click('撤回');
  expect(button('撤回').disabled).toBe(true);
  await complete('unverified');
  expect(button('撤回').disabled).toBe(false);
  expect(holder.textContent).not.toContain('已撤回本次回填');
});

it('passes a live target guard and ignores success after the target changes', async () => {
  await finish();
  const complete = pendingReplacement();
  await click('采用');
  const options = replaceMock.mock.calls[0]?.[3];
  expect(options?.isCurrent?.()).toBe(true);
  current = false;
  expect(options?.isCurrent?.()).toBe(false);
  await complete('applied');
  expect(button('撤回')).toBeUndefined();
  expect(holder.textContent).toContain('回复对象已改变');
});

it('aborts pending replacement immediately on close', async () => {
  await finish();
  const complete = pendingReplacement();
  await click('采用');
  const options = replaceMock.mock.calls[0]?.[3];
  await click('关闭');
  expect(options?.signal?.aborted).toBe(true);
  expect(options?.isCurrent?.()).toBe(false);
  await complete('applied');
  expect(holder.textContent).not.toContain('已回填到 X');
  expect(button('撤回')).toBeUndefined();
});

it('aborts replacement on unmount and ignores its later completion', async () => {
  await finish();
  const complete = pendingReplacement();
  await click('采用');
  const signal = replaceMock.mock.calls[0]?.[3]?.signal;
  await act(async () => root.unmount());
  root = createRoot(holder);
  expect(signal?.aborted).toBe(true);
  await complete('applied');
  expect(holder.textContent).toBe('');
});

it('aborts replacement when the editor prop changes', async () => {
  await finish();
  const complete = pendingReplacement();
  await click('采用');
  const options = replaceMock.mock.calls[0]?.[3];
  const nextEditor = document.createElement('div');
  nextEditor.textContent = '新的草稿';
  document.body.append(nextEditor);
  await act(async () => root.render(<XAssistant editor={nextEditor} initialContext={emptyContext()} isCurrent={() => current} onClose={() => {}} />));
  expect(options?.signal?.aborted).toBe(true);
  expect(options?.isCurrent?.()).toBe(false);
  await complete('applied');
  expect(button('撤回')).toBeUndefined();
  expect(nextEditor.textContent).toBe('新的草稿');
  expect(holder.textContent).not.toContain('已回填到 X');
});

it('does not mistake unchanged output for an already verified adoption', async () => {
  await finish({ type: 'done', text: '我还没试过', kind: 'translation' });
  replaceMock.mockResolvedValueOnce('unverified');
  await click('采用');
  expect(replaceMock).toHaveBeenCalledTimes(1);
  expect(holder.textContent).not.toContain('已经采用');
});
