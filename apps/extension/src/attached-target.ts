import type { AttachedTarget } from '@waypoint/shared-types';

// Keep the worker bundle standalone (the recorder uses classic script injection).
const ATTACHED_TARGET_ATTRIBUTE = 'data-waypoint-attach-token';
import { isRecordableUrl } from './recordable-url.js';

/** Called with the side panel's own window, never the worker's last-focused window. */
export async function captureAttachedTarget(windowId: number): Promise<AttachedTarget> {
  if (!Number.isInteger(windowId) || windowId < 0) throw new Error('Cannot identify the side panel window.');
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id === undefined || tab.windowId !== windowId || !isRecordableUrl(tab.url) || tab.pendingUrl) {
    throw new Error('Select a loaded HTTP, HTTPS, or local fixture page in this side panel window, then run again.');
  }
  const token = crypto.randomUUID();
  let result: chrome.scripting.InjectionResult<{ url: string }>[];
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: (attribute, token) => {
        document.documentElement.setAttribute(attribute, token);
        setTimeout(() => {
          if (document.documentElement.getAttribute(attribute) === token) document.documentElement.removeAttribute(attribute);
        }, 60_000);
        return { url: location.href };
      },
      args: [ATTACHED_TARGET_ATTRIBUTE, token]
    });
  } catch {
    throw new Error('Cannot identify this webpage. Grant Waypoint site access (and file access for local fixtures), then try again.');
  }
  const main = result.find(frame => frame.frameId === 0);
  const current = await chrome.tabs.get(tab.id);
  if (!main?.result || main.result.url !== tab.url || current.url !== tab.url || !current.active || current.windowId !== windowId || current.pendingUrl) {
    throw new Error('The selected tab changed while starting playback. Select it and run again.');
  }
  return { tabId: tab.id, windowId, url: main.result.url, token,
    ...(main.documentId ? { documentId: main.documentId } : {}) };
}
