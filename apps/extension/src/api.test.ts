import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranslateInput, TranslationEvent } from '@sayseed/shared';
import { emptyContext } from '@sayseed/shared';
import { translate } from './api';

afterEach(() => vi.unstubAllGlobals());
function fixture(input: TranslateInput = { draft: '中文', context: emptyContext() }) {
  const messages: ((event: TranslationEvent) => void)[] = [];
  const disconnected: (() => void)[] = [];
  const port = {
    onMessage: { addListener: (handler: typeof messages[number]) => messages.push(handler) },
    onDisconnect: { addListener: (handler: () => void) => disconnected.push(handler) },
    postMessage: vi.fn(),
    disconnect: vi.fn(() => disconnected.forEach(handler => handler())),
  };
  vi.stubGlobal('chrome', { runtime: { connect: () => port } });
  const onEvent = vi.fn();
  const stream = translate(input, onEvent);
  return { port, stream, onEvent, emit: (event: TranslationEvent) => messages.forEach(handler => handler(event)) };
}

describe('translation port lifecycle', () => {
  it('reports an unexpected disconnect so the UI cannot remain streaming', () => {
    const { port, onEvent } = fixture();
    port.disconnect();
    expect(onEvent).toHaveBeenCalledWith({ type: 'error', message: '与翻译服务的连接已中断' });
  });
  it('ignores late packets after explicit cancellation', () => {
    const { stream, emit, onEvent } = fixture();
    stream.cancel(); emit({ type: 'delta', text: 'Late response' });
    expect(onEvent).not.toHaveBeenCalled();
  });
  it('closes a completed port without replacing the result with a disconnect error', () => {
    const { emit, onEvent, port } = fixture();
    emit({ type: 'done', text: 'Translated.', kind: 'translation' });
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'done', text: 'Translated.', kind: 'translation' });
  });
  it('sends text-only target, ancestor and quoted context without changing the original input', () => {
    const input: TranslateInput = { draft: '中文', context: {
      mode: 'quote', supplement: '补充说明', incompleteReasons: [],
      target: { id: '1', text: 'Direct text', images: ['https://pbs.twimg.com/media/target.jpg'] },
      ancestors: [
        { id: '2', text: 'Earlier text', images: ['data:image/png;base64,ancestor'] },
        { id: '3', text: 'Another text', images: ['https://pbs.twimg.com/media/ancestor.jpg'] },
      ],
      quoted: { id: '4', text: 'Quoted text', images: ['https://pbs.twimg.com/media/quote.jpg'] },
    } };
    const original = structuredClone(input);
    const { port } = fixture(input);
    const sent = port.postMessage.mock.calls[0]![0] as { type: string; input: TranslateInput };
    expect(sent.type).toBe('translate');
    expect(sent.input.context.target).toMatchObject({ id: '1', text: 'Direct text', images: [] });
    expect(sent.input.context.ancestors.map(post => post.images)).toEqual([[], []]);
    expect(sent.input.context.quoted).toMatchObject({ id: '4', text: 'Quoted text', images: [] });
    expect(sent.input.context.supplement).toBe('补充说明');
    expect(input).toEqual(original);
    expect(sent.input.context).not.toBe(input.context);
    expect(JSON.stringify(sent)).not.toContain('pbs.twimg.com/media/');
  });
});
