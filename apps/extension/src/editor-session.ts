import type { TranslationContext } from '@sayseed/shared';
import { contextIdentity, isVisible } from './x-dom';

export function bindEditorSession(editor: HTMLElement, readContext: () => TranslationContext) {
  const dialog = editor.closest('[role="dialog"]');
  const url = location.href;
  const identity = contextIdentity(readContext());
  return () => editor.isConnected && isVisible(editor) && location.href === url &&
    editor.closest('[role="dialog"]') === dialog &&
    (dialog !== null || !document.querySelector('[role="dialog"]')) &&
    contextIdentity(readContext()) === identity;
}
