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

let root: Root;
let editor: HTMLElement;
let holder: HTMLElement;
let current: boolean;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
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
