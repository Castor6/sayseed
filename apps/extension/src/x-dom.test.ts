// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { captureTarget, classifyEditor, contextIdentity, extractPost, findEditors, findSubmitButton, replaceEditorText, syncAssistantButton } from './x-dom';

const editor = (hint = '有什么新鲜事？') => `<div data-testid="tweetTextarea_0" contenteditable="true" data-placeholder="${hint}">我想试试</div>`;
const realEditor = (hint: string) => `<div class="DraftEditor-root"><div id="placeholder-5iogk" class="public-DraftEditorPlaceholder-root">${hint}</div><div data-testid="tweetTextarea_0" contenteditable="true" aria-label="帖子文本" aria-describedby="placeholder-5iogk">我想试试</div></div>`;
const post = (id: number, name: string, text: string, extra = '') => `<article>
  <div data-testid="User-Name">${name}</div><a href="/alice/status/${id}"><time>9月24日</time></a>
  <div data-testid="tweetText">${text}</div><img src="https://pbs.twimg.com/profile_images/avatar.jpg"/>
  ${extra}</article>`;

beforeEach(() => { document.body.innerHTML = ''; history.replaceState({}, '', '/home'); });

describe('X compose entrypoints', () => {
  it('keeps the home composer and standalone compose dialog in post mode', () => {
    document.body.innerHTML = `<main>${editor()}</main><div role="dialog"><div>所有人可以回复</div>${editor()}</div>`;
    const [home, modal] = [...document.querySelectorAll<HTMLElement>('[contenteditable]')];
    expect(classifyEditor(home!).mode).toBe('post');
    expect(classifyEditor(modal!).mode).toBe('post');
  });

  it('binds the inline detail reply to the current status article only', () => {
    history.replaceState({}, '', '/alice/status/100');
    document.body.innerHTML = `<div data-testid="primaryColumn">${post(100, 'Alice @alice', 'The parent post')}${post(101, 'Other @other', 'Unrelated comment')}${realEditor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!);
    expect(result.mode).toBe('reply');
    expect(result.target?.id).toBe('100');
    expect(result.target?.text).toBe('The parent post');
    expect(result.ancestors).toEqual([]);
    expect(result.incompleteReasons).toEqual([]);
  });

  it('keeps an already typed inline detail editor in reply mode after placeholder disappears', () => {
    history.replaceState({}, '', '/alice/status/100');
    document.body.innerHTML = `<div data-testid="primaryColumn">${post(100, 'Alice @alice', 'Parent')}<div data-testid="tweetTextarea_0" contenteditable="true" aria-label="帖子文本">我同意</div></div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!);
    expect(result.mode).toBe('reply');
    expect(result.target?.id).toBe('100');
  });

  it('binds a nested reply dialog to its own article and recovers captured source URL', () => {
    document.body.innerHTML = `<div data-testid="primaryColumn">${post(100, 'Root @root', 'Outside')}</div><div role="dialog"><div role="dialog"><article><div data-testid="User-Name">Bob @bob</div><div data-testid="tweetText">Inside</div></article><div>回复 @bob</div>${editor('发布你的回复')}</div></div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, { post: { id: '200', author: 'Bob @bob', text: 'Inside', url: 'https://x.com/bob/status/200', images: [] }, at: Date.now() });
    expect(result.mode).toBe('reply');
    expect(result.target?.id).toBe('200');
    expect(result.target?.text).toBe('Inside');
    expect(result.incompleteReasons).toEqual([]);
  });

  it('recognizes a quote card rendered as a div role button', () => {
    document.body.innerHTML = `<div role="dialog">${editor('添加评论')}<div role="button"><div data-testid="User-Name">Alice @alice</div><div data-testid="tweetText">Original idea</div></div></div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, { post: { text: 'Stale reply', images: [] }, at: Date.now() }, { post: { id: '100', url: 'https://x.com/alice/status/100', author: 'Alice @alice', text: 'Original idea', images: [] }, at: Date.now() });
    expect(result.mode).toBe('quote');
    expect(result.quoted?.id).toBe('100');
    expect(result.target).toBeUndefined();
    expect(result.incompleteReasons).toEqual([]);
  });

  it('recovers a quoted post source despite a wrapped image shortlink', () => {
    document.body.innerHTML = `<div role="dialog">${editor('添加评论')}<div role="button"><div data-testid="User-Name">Alice @alice</div><div data-testid="tweetText">Original idea https://\npic.x.com/photo123</div></div></div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, undefined, { post: { id: '100', url: 'https://x.com/alice/status/100', author: 'Alice @alice', text: 'Original idea', images: [] }, at: Date.now() });
    expect(result.mode).toBe('quote');
    expect(result.quoted?.url).toBe('https://x.com/alice/status/100');
    expect(result.incompleteReasons).toEqual([]);
  });

  it('warns when a quote dialog has no readable quoted card', () => {
    document.body.innerHTML = `<div role="dialog">${editor('添加评论')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!);
    expect(result.mode).toBe('quote');
    expect(result.incompleteReasons).toEqual(['未能读取被引用的帖子，请手动补充内容']);
  });

  it('keeps a direct reply distinct from a quote card nested inside its article', () => {
    document.body.innerHTML = `<div role="dialog"><article>
      <div data-testid="User-Name">Bob @bob</div><a href="/bob/status/200"><time>9月24日</time></a>
      <div data-testid="tweetText">Bob’s own thought</div>
      <div role="button"><div data-testid="User-Name">Alice @alice</div><a href="/alice/status/100"><time>9月23日</time></a><div data-testid="tweetText">Quoted thought</div><img src="https://pbs.twimg.com/media/quote.jpg" /></div>
      </article><span>回复 @bob</span>${editor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, undefined, { post: { id: '100', text: 'Quoted thought', images: [] }, at: Date.now() });
    expect(result.mode).toBe('reply');
    expect(result.target).toMatchObject({ id: '200', author: 'Bob @bob', text: 'Bob’s own thought', images: [] });
    expect(result.quoted).toBeUndefined();
    expect(result.incompleteReasons).toEqual([]);
  });

  it('keeps a quote-only direct reply target instead of substituting its nested quote', () => {
    document.body.innerHTML = `<div role="dialog"><article>
      <div data-testid="User-Name">Bob @bob</div><a href="/bob/status/200"><time>9月24日</time></a>
      <div role="button"><div data-testid="User-Name">Alice @alice</div><a href="/alice/status/100"><time>9月23日</time></a><div data-testid="tweetText">Quoted thought</div><img src="https://pbs.twimg.com/media/quote.jpg" /></div>
      </article><span>回复 @bob</span>${editor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!);
    expect(result.mode).toBe('reply');
    expect(result.target).toMatchObject({ id: '200', author: 'Bob @bob', text: '', images: [] });
    expect(result.incompleteReasons).toEqual(['直接回复对象只有引用卡，未读取到独立正文；可手动补充语境']);
  });

  it('recognizes a pure-image quote after the comment placeholder disappears', () => {
    document.body.innerHTML = `<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true" aria-label="帖子文本">想说点什么</div>
      <div role="button"><div data-testid="User-Name">Alice @alice</div><img src="https://pbs.twimg.com/media/photo.jpg?name=small" /></div></div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!,
      { post: { id: '999', text: 'Stale reply', images: [] }, at: Date.now() },
      { post: { id: '100', author: 'Alice @alice', text: '', url: 'https://x.com/alice/status/100', images: ['https://pbs.twimg.com/media/photo.jpg?name=large'] }, at: Date.now() });
    expect(result.mode).toBe('quote');
    expect(result.quoted).toMatchObject({ id: '100', text: '', url: 'https://x.com/alice/status/100', images: ['https://pbs.twimg.com/media/photo.jpg?name=small'] });
    expect(result.incompleteReasons).toEqual([]);
  });

  it('does not apply a stale captured quote to a different visible card', () => {
    document.body.innerHTML = `<div role="dialog">${editor('添加评论')}<div role="button"><div data-testid="User-Name">Carol @carol</div><div data-testid="tweetText">Different post</div></div></div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, undefined,
      { post: { id: '100', author: 'Alice @alice', text: 'Original idea', url: 'https://x.com/alice/status/100', images: [] }, at: Date.now() });
    expect(result.mode).toBe('quote');
    expect(result.quoted).toMatchObject({ author: 'Carol @carol', text: 'Different post' });
    expect(result.quoted?.id).toBeUndefined();
  });

  it('matches the direct reply after a modal route change and ignores a wrapped image shortlink', () => {
    history.replaceState({}, '', '/alice/status/100');
    document.body.innerHTML = `${post(100, 'Alice @alice', 'Root idea')}${post(200, 'Bob @bob', 'Child idea')}`;
    const captured = captureTarget(document.querySelectorAll('article')[1]!);
    history.replaceState({}, '', '/compose/post');
    document.body.innerHTML = `<div role="dialog"><article><div data-testid="User-Name">Bob @bob · 9月24日</div><div data-testid="tweetText">Child idea https://\npic.x.com/media123</div></article><button>回复 @bob 和 @alice</button>${realEditor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, captured);
    expect(result.target?.id).toBe('200');
    expect(result.target?.url).toBe(captured?.post.url);
    expect(result.ancestors).toEqual([]);
    expect(result.incompleteReasons).toEqual([]);
  });

  it('warns only when the direct reply object is missing', () => {
    document.body.innerHTML = `<div role="dialog"><span>回复 @bob</span>${realEditor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!);
    expect(result.mode).toBe('reply');
    expect(result.target).toBeUndefined();
    expect(result.incompleteReasons).toEqual(['未能读取直接回复的帖子，请手动补充内容']);
  });

  it('does not reuse a captured target for a different article', () => {
    document.body.innerHTML = `<div role="dialog"><article><div data-testid="User-Name">Carol @carol</div><div data-testid="tweetText">Another post</div></article>${editor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!, { post: { id: '200', author: 'Bob @bob', text: 'Inside', url: 'https://x.com/bob/status/200', images: [] }, at: Date.now() });
    expect(result.target?.id).toBeUndefined();
    expect(result.target?.text).toBe('Another post');
  });
});

describe('post extraction and session identity', () => {
  it('retains pure image posts and excludes avatars', () => {
    document.body.innerHTML = post(301, 'Ada @ada', '', '<img src="https://pbs.twimg.com/media/photo1.jpg" />');
    const result = extractPost(document.querySelector('article')!);
    expect(result?.id).toBe('301');
    expect(result?.images).toEqual(['https://pbs.twimg.com/media/photo1.jpg']);
  });

  it('never includes an ancestor when replying to a loaded comment', () => {
    history.replaceState({}, '', '/alice/status/100');
    document.body.innerHTML = `${post(100, 'Alice @alice', 'Root idea')}<div role="dialog">${post(200, 'Bob @bob', 'A reply', '<span>Replying to @alice</span>')}${editor('发布你的回复')}</div>`;
    const result = classifyEditor(document.querySelector<HTMLElement>('[contenteditable]')!);
    expect(result.target?.id).toBe('200');
    expect(result.ancestors).toEqual([]);
    expect(result.incompleteReasons).toEqual([]);
  });

  it('changes identity for a different image or author even without post URL', () => {
    const a = { mode: 'reply' as const, target: { text: '', author: 'A', images: ['https://pbs.twimg.com/media/a.jpg'] }, ancestors: [], supplement: '', incompleteReasons: [] };
    const b = { ...a, target: { ...a.target, images: ['https://pbs.twimg.com/media/b.jpg'] } };
    expect(contextIdentity(a)).not.toBe(contextIdentity(b));
  });

  it('refuses to overwrite a changed editor draft', () => {
    document.body.innerHTML = editor();
    const node = document.querySelector<HTMLElement>('[contenteditable]')!;
    node.textContent = '另一份草稿';
    expect(replaceEditorText(node, '我想试试', 'English')).toBe(false);
    expect(node.textContent).toBe('另一份草稿');
  });

  it('only discovers visible editors', () => {
    document.body.innerHTML = `${editor()}${editor()}`;
    const nodes = [...document.querySelectorAll<HTMLElement>('[contenteditable]')];
    nodes[0]!.getBoundingClientRect = () => ({ width: 100, height: 30 } as DOMRect);
    nodes[1]!.getBoundingClientRect = () => ({ width: 0, height: 0 } as DOMRect);
    expect(findEditors()).toEqual([nodes[0]]);
  });
});

describe('assistant button anchor', () => {
  function visible(element: HTMLElement) { element.getBoundingClientRect = () => ({ width: 100, height: 30 } as DOMRect); }

  it('inserts beside the column wrapper of the real inline submit row', () => {
    history.replaceState({}, '', '/alice/status/100');
    document.body.innerHTML = `<div data-testid="primaryColumn"><div class="composer">${editor('发布你的回复')}
      <div data-testid="toolBar" style="display:flex"><div class="actions" style="display:flex;align-items:center">
        <div class="submit-wrap" style="display:flex;flex-direction:column"><button data-testid="tweetButtonInline">回复</button></div>
      </div></div></div></div>`;
    const node = document.querySelector<HTMLElement>('[contenteditable]')!;
    const submit = document.querySelector<HTMLElement>('[data-testid="tweetButtonInline"]')!;
    const toolbar = document.querySelector<HTMLElement>('[data-testid="toolBar"]')!;
    visible(node); visible(submit); visible(toolbar);
    expect(findSubmitButton(node)).toBe(submit);
    const sayseed = syncAssistantButton(node, undefined, () => document.createElement('button'))!;
    expect(sayseed.previousElementSibling).toBe(submit.parentElement);
    expect(sayseed.parentElement).toBe(submit.parentElement?.parentElement);
    expect(syncAssistantButton(node, sayseed, () => { throw Error('should reuse'); })).toBe(sayseed);
  });

  it('removes and reinserts the production button as detail reply toolbar collapses and expands', () => {
    history.replaceState({}, '', '/alice/status/100');
    document.body.innerHTML = `<div data-testid="primaryColumn"><div class="composer">${editor('发布你的回复')}
      <div data-testid="toolBar" hidden style="display:flex"><div class="actions" style="display:flex"><div style="display:flex;flex-direction:column"><button data-testid="tweetButtonInline">回复</button></div></div></div>
      </div></div>`;
    const node = document.querySelector<HTMLElement>('[contenteditable]')!;
    const submit = document.querySelector<HTMLElement>('[data-testid="tweetButtonInline"]')!;
    const toolbar = document.querySelector<HTMLElement>('[data-testid="toolBar"]')!;
    visible(node); visible(submit); visible(toolbar);
    let creations = 0;
    const create = () => { creations++; return document.createElement('button'); };
    let button = syncAssistantButton(node, undefined, create);
    expect(button).toBeUndefined();
    expect(creations).toBe(0);
    toolbar.hidden = false;
    button = syncAssistantButton(node, button, create);
    expect(button).toBeTruthy();
    expect(button?.parentElement).toBe(submit.parentElement?.parentElement);
    expect(creations).toBe(1);
    toolbar.hidden = true;
    button = syncAssistantButton(node, button, create);
    expect(button).toBeUndefined();
    expect(document.querySelector('.actions')?.children).toHaveLength(1);
  });

  it('waits for a submit button rather than placing Sayseed below the editor', () => {
    document.body.innerHTML = `<div data-testid="primaryColumn"><div class="avatar"></div><div class="editor-wrap">${editor('发布你的回复')}</div></div>`;
    const node = document.querySelector<HTMLElement>('[contenteditable]')!;
    visible(node);
    expect(findSubmitButton(node)).toBeNull();
  });

  it('keeps the compose dialog anchored to its own Post button', () => {
    document.body.innerHTML = `<div data-testid="primaryColumn"><button data-testid="tweetButtonInline">发帖</button></div><div role="dialog"><div class="composer">${editor()}<div><button data-testid="tweetButton">发帖</button></div></div></div>`;
    const node = document.querySelector<HTMLElement>('[contenteditable]')!;
    const submit = document.querySelector<HTMLElement>('[data-testid="tweetButton"]')!;
    visible(node); visible(submit);
    expect(findSubmitButton(node)).toBe(submit);
  });
});
