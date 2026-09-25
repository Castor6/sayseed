import type { ContextPost, TranslationContext } from '@sayseed/shared';

export const EDITOR_SELECTOR = '[data-testid="tweetTextarea_0"][contenteditable="true"]';
export const ASSISTANT_BUTTON_STYLE = 'display:inline-flex;align-items:center;justify-content:center;align-self:center;vertical-align:middle;border:0;background:transparent;color:#16955d;font:700 14px/1 system-ui;padding:5px 8px;margin-left:6px;white-space:nowrap;flex-shrink:0;cursor:pointer;';
const STATUS_LINK = 'a[href*="/status/"]';

export function editorText(editor: HTMLElement): string {
  return (editor.innerText || editor.textContent || '').trim();
}

export function currentEditorTarget(editor: HTMLElement): HTMLElement {
  const dialog = editor.closest('[role="dialog"]');
  return (dialog || editor.closest('[data-testid="primaryColumn"]') || editor.parentElement || editor) as HTMLElement;
}

export function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

export function findEditors(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].filter(isVisible);
}

export function findSubmitButton(editor: HTMLElement): HTMLElement | null {
  const boundary = editor.closest('[role="dialog"]') || editor.closest('[data-testid="primaryColumn"]') || document.body;
  let parent = editor.parentElement;
  while (parent) {
    const editors = findEditors(parent);
    if (editors.length === 1 && editors[0] === editor) {
      const known = [...parent.querySelectorAll<HTMLElement>('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]')]
        .map(node => node.closest<HTMLElement>('button, [role="button"]') || node)
        .filter((button, index, values) => values.indexOf(button) === index && isVisible(button) && !button.contains(editor));
      if (known.length === 1) return known[0]!;
      if (!known.length) {
        const labeled = [...parent.querySelectorAll<HTMLElement>('button, [role="button"]')]
          .filter(button => isVisible(button) && !button.closest('article') && /^(回复|Reply|发帖|Post)$/i.test((button.getAttribute('aria-label') || button.textContent || '').trim()));
        if (labeled.length === 1) return labeled[0]!;
      }
    }
    if (parent === boundary) break;
    parent = parent.parentElement;
  }
  return null;
}

function isCollapsedDetailReply(editor: HTMLElement, submit: HTMLElement): boolean {
  if (!statusUrl() || editor.closest('[role="dialog"]') || !editor.closest('[data-testid="primaryColumn"]')) return false;
  const toolbar = submit.closest<HTMLElement>('[data-testid="toolBar"]');
  return !toolbar || !!toolbar.hidden || !isVisible(toolbar);
}

function assistantInsertionAnchor(submit: HTMLElement): HTMLElement {
  const parent = submit.parentElement;
  const row = parent?.parentElement;
  if (parent && row && getComputedStyle(parent).display.includes('flex') && getComputedStyle(parent).flexDirection === 'column' &&
    getComputedStyle(row).display.includes('flex') && getComputedStyle(row).flexDirection !== 'column') return parent;
  return submit;
}

export function syncAssistantButton(editor: HTMLElement, existing: HTMLButtonElement | undefined, create: () => HTMLButtonElement): HTMLButtonElement | undefined {
  const submit = findSubmitButton(editor);
  if (!submit || isCollapsedDetailReply(editor, submit)) {
    existing?.remove();
    return undefined;
  }
  const anchor = assistantInsertionAnchor(submit);
  const button = existing || create();
  if (button.parentElement !== anchor.parentElement || button.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', button);
  return button;
}

function isNestedQuote(node: Element, root: Element): boolean {
  if (root.tagName !== 'ARTICLE') return false;
  let parent = node.parentElement;
  while (parent && parent !== root) {
    if (parent.matches('[data-testid="quoteTweet"], [data-testid="quotedTweet"]')) return true;
    if (parent.matches('[role="button"]') && (
      parent.querySelector('[data-testid="tweetText"]') ||
      (parent.querySelector('[data-testid="User-Name"]') && parent.querySelector('img[src*="pbs.twimg.com/media/"]'))
    )) return true;
    parent = parent.parentElement;
  }
  return false;
}

function belongsToPost(node: Element, root: Element): boolean {
  return (root.tagName !== 'ARTICLE' || node.closest('article') === root) && !isNestedQuote(node, root);
}

export function extractPost(article: Element, fallbackUrl = ''): ContextPost | undefined {
  const tweet = [...article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]')].find(node => belongsToPost(node, article));
  const text = (tweet?.innerText || tweet?.textContent || '').trim();
  const authorNode = [...article.querySelectorAll<HTMLElement>('[data-testid="User-Name"]')].find(node => belongsToPost(node, article));
  const author = (authorNode?.textContent || '').trim().slice(0, 200);
  const links = [...article.querySelectorAll<HTMLAnchorElement>(STATUS_LINK)].filter(a => belongsToPost(a, article) && /\/status\/\d+/.test(a.href));
  const link = links.find(a => a.querySelector('time')) || links[0];
  const images = [...article.querySelectorAll<HTMLImageElement>('img[src*="pbs.twimg.com/media/"]')]
    .filter(image => belongsToPost(image, article))
    .map(image => image.src).filter((url, index, values) => values.indexOf(url) === index).slice(0, 4);
  const url = link?.href || fallbackUrl;
  const id = url.match(/\/status\/(\d+)/)?.[1];
  const quoteOnly = article.tagName === 'ARTICLE' && !!article.querySelector('[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="button"] [data-testid="tweetText"], [role="button"] img[src*="pbs.twimg.com/media/"]');
  if (!text && !images.length && !(quoteOnly && (id || author))) return undefined;
  return { ...(id ? { id } : {}), ...(author ? { author } : {}), text, ...(url ? { url } : {}), images };
}

export function statusUrl(): string {
  return /\/status\/\d+/.test(location.pathname) ? location.href : '';
}

export interface CapturedTarget { post: ContextPost; at: number }

export function contextIdentity(context: TranslationContext): string {
  const key = (post?: ContextPost) => post ? [post.id || '', post.url || '', post.author?.match(/@[\w]+/)?.[0] || post.author || '', post.text, ...post.images].join('|') : '';
  return [context.mode, key(context.target), key(context.quoted), ...context.ancestors.map(key)].join('::');
}

function normalizedPostText(text: string): string {
  return text.replace(/https?:\/\/[\s\u200b]*(?:pic\.x\.com|pic\.twitter\.com)\/\S+/gi, '').replace(/\s+/g, ' ').trim();
}

function samePost(post: ContextPost, captured: ContextPost): boolean {
  if (post.id && captured.id) return post.id === captured.id;
  const handle = (value?: string) => value?.match(/@[\w]+/)?.[0]?.toLowerCase();
  const currentHandle = handle(post.author), oldHandle = handle(captured.author);
  const sameAuthor = !currentHandle || !oldHandle || currentHandle === oldHandle;
  const sameText = normalizedPostText(post.text) === normalizedPostText(captured.text);
  const imageIdentity = (value: string) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value; } };
  const sameImages = !!normalizedPostText(post.text) || (
    post.images.length === 0 && captured.images.length === 0 ||
    post.images.length > 0 && captured.images.length > 0 && post.images.some(image => captured.images.some(old => imageIdentity(image) === imageIdentity(old)))
  );
  return sameAuthor && sameText && sameImages;
}

function withCapturedSource(post: ContextPost | undefined, captured?: ContextPost): ContextPost | undefined {
  if (!post) return captured;
  if (!captured || post.url || post.id) return post;
  return samePost(post, captured) ? { ...post, id: captured.id, url: captured.url, images: post.images.length ? post.images : captured.images } : post;
}

export function captureTarget(article: Element): CapturedTarget | undefined {
  const post = extractPost(article);
  if (!post) return undefined;
  return { post, at: Date.now() };
}

function editorHint(editor: HTMLElement): string {
  const described = (editor.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
  const placeholder = editor.closest('.DraftEditor-root')?.querySelector('.public-DraftEditorPlaceholder-root')?.textContent || '';
  return [editor.getAttribute('data-placeholder'), editor.getAttribute('aria-label'), described, placeholder].filter(Boolean).join(' ');
}

export function classifyEditor(editor: HTMLElement, capturedReply?: CapturedTarget, capturedQuote?: CapturedTarget): TranslationContext {
  const dialog = editor.closest('[role="dialog"]');
  const current = Date.now();
  const freshReply = capturedReply && current - capturedReply.at < 30000 ? capturedReply.post : undefined;
  const freshQuote = capturedQuote && current - capturedQuote.at < 30000 ? capturedQuote.post : undefined;
  const hint = editorHint(editor);
  if (dialog) {
    const quoteCard = [...dialog.querySelectorAll<HTMLElement>('[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="button"]')]
      .find(card => !card.contains(editor) && !card.closest('article') && !!card.querySelector('[data-testid="tweetText"], img[src*="pbs.twimg.com/media/"]'));
    const quotePost = quoteCard && extractPost(quoteCard);
    const article = [...dialog.querySelectorAll('article')].find(candidate => !candidate.contains(editor) && !quoteCard?.contains(candidate) && !candidate.closest('[role="button"]'));
    const quoteHint = /添加评论|Add a comment/i.test(hint);
    const quoteMatchesCapture = !!quotePost && !!freshQuote && samePost(quotePost, freshQuote);
    const isQuote = (quoteHint && (!article || !!quoteCard)) || quoteMatchesCapture || (!article && !!quoteCard && !freshReply);
    if (isQuote) {
      const quoted = quotePost ? withCapturedSource(quotePost, freshQuote) : undefined;
      return { mode: 'quote', ancestors: [], quoted, supplement: '', incompleteReasons: quoted ? [] : ['未能读取被引用的帖子，请手动补充内容'] };
    }
    const isReply = !!article || /回复\s*@|Replying to\s*@/i.test(dialog.textContent?.slice(0, 500) || '');
    if (!isReply) return { mode: 'post', ancestors: [], supplement: '', incompleteReasons: [] };
    const target = withCapturedSource((article && extractPost(article)) || undefined, freshReply);
    const incompleteReasons = !target ? ['未能读取直接回复的帖子，请手动补充内容'] : !target.text && !target.images.length ? ['直接回复对象只有引用卡，未读取到独立正文；可手动补充语境'] : [];
    return { mode: 'reply', ancestors: [], target, supplement: '', incompleteReasons };
  }
  const pageStatus = statusUrl();
  const inlineOnDetail = !!pageStatus && !!editor.closest('[data-testid="primaryColumn"]');
  if (pageStatus && (inlineOnDetail || /发布你的回复|Post your reply|回复\s*@|Replying to/i.test(hint))) {
    const article = [...document.querySelectorAll('article')].find(a => a.querySelector(`a[href*="${new URL(pageStatus).pathname}"]`));
    const target = (article && extractPost(article, pageStatus)) || freshReply;
    return { mode: 'reply', ancestors: [], target, supplement: '', incompleteReasons: target ? [] : ['未能读取当前帖子，请手动补充内容'] };
  }
  return { mode: 'post', ancestors: [], supplement: '', incompleteReasons: [] };
}

export function replaceEditorText(editor: HTMLElement, expected: string, next: string): boolean {
  if (!editor.isConnected || editorText(editor) !== expected) return false;
  editor.focus();
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand('insertText', false, next);
  if (!inserted) {
    editor.textContent = next;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
  }
  return true;
}
