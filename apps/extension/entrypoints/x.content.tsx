import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XAssistant } from '../src/x-ui';
import { ASSISTANT_BUTTON_STYLE, captureTarget, classifyEditor, findEditors, syncAssistantButton, type CapturedTarget } from '../src/x-dom';
import { bindEditorSession } from '../src/editor-session';
import { overlayCss } from '../src/style';

function closestActionTarget(start: EventTarget | null): Element | null {
  return start instanceof Element ? start.closest('button, [role="button"], [role="menuitem"], a[data-testid="SideNav_NewTweet_Button"]') : null;
}

export default defineContentScript({
  matches: ['https://x.com/*', 'https://*.x.com/*'],
  runAt: 'document_idle',
  main() {
    const buttons = new Map<HTMLElement, HTMLButtonElement>();
    let reply: CapturedTarget | undefined;
    let pendingQuote: CapturedTarget | undefined;
    let quote: CapturedTarget | undefined;
    let host: HTMLElement | null = null;
    let root: Root | null = null;
    let sessionValid: (() => boolean) | null = null;
    let lastUrl = location.href;
    let hadDialog = false;

    function close() { root?.unmount(); root = null; host?.remove(); host = null; sessionValid = null; }
    function open(editor: HTMLElement) {
      close();
      const readContext = () => classifyEditor(editor, reply && { ...reply, at: Date.now() }, quote && { ...quote, at: Date.now() });
      const context = readContext();
      const isCurrent = bindEditorSession(editor, readContext);
      sessionValid = isCurrent;
      host = document.createElement('div');
      host.dataset.sayseedOverlay = 'true';
      host.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } });
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = overlayCss; shadow.append(style);
      const container = document.createElement('div'); shadow.append(container);
      document.body.append(host);
      root = createRoot(container);
      root.render(<XAssistant editor={editor} initialContext={context} isCurrent={isCurrent} onClose={close} />);
    }
    function scan() {
      if (lastUrl !== location.href) {
        close();
        if (!/^\/compose\/(post|tweet)/.test(location.pathname)) { reply = undefined; pendingQuote = undefined; quote = undefined; }
        lastUrl = location.href;
      }
      const hasDialog = !!document.querySelector('[role="dialog"]');
      if (hadDialog && !hasDialog) { reply = undefined; pendingQuote = undefined; quote = undefined; }
      hadDialog = hasDialog;
      if (sessionValid && !sessionValid()) close();
      for (const [editor, button] of buttons) {
        if (!editor.isConnected || !button.isConnected || !findEditors().includes(editor)) { button.remove(); buttons.delete(editor); }
      }
      for (const editor of findEditors()) {
        const existing = buttons.get(editor);
        const button = syncAssistantButton(editor, existing, () => {
          const created = document.createElement('button');
          created.type = 'button'; created.textContent = 'Sayseed'; created.className = 'sayseed-assistant-button';
          created.style.cssText = ASSISTANT_BUTTON_STYLE;
          created.setAttribute('aria-label', '用 Sayseed 翻译');
          created.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(editor); });
          return created;
        });
        if (button) buttons.set(editor, button);
        else buttons.delete(editor);
      }
      if (host && !document.body.contains(host)) close();
    }
    document.addEventListener('click', event => {
      const button = closestActionTarget(event.target);
      if (!button || button.classList.contains('sayseed-assistant-button')) return;
      const testId = button.getAttribute('data-testid') || '';
      const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
      const article = button.closest('article');
      if (article && (testId === 'reply' || /^回复|^Reply/i.test(label))) {
        reply = captureTarget(article); quote = undefined; pendingQuote = undefined;
      }
      if (article && (testId === 'retweet' || /转帖|Repost|Retweet/i.test(label))) {
        pendingQuote = captureTarget(article);
      }
      if ((button.getAttribute('role') === 'menuitem' || button.closest('[role="menu"]')) && /引用|Quote/i.test(label)) {
        if (pendingQuote && Date.now() - pendingQuote.at < 30000) { quote = pendingQuote; reply = undefined; }
      }
      if (testId === 'SideNav_NewTweet_Button' || /^(发帖|Post)$/i.test(label)) { reply = undefined; quote = undefined; pendingQuote = undefined; }
    }, true);
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true; requestAnimationFrame(() => { scheduled = false; scan(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
    window.addEventListener('popstate', () => { reply = undefined; pendingQuote = undefined; quote = undefined; close(); scan(); });
    const navigationCheck = setInterval(() => { if (location.href !== lastUrl) scan(); }, 500);
    window.addEventListener('pagehide', () => { clearInterval(navigationCheck); observer.disconnect(); close(); }, { once: true });
  },
});
