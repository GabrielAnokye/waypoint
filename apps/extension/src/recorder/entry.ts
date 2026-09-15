/**
 * Self-executing entry point for the content recorder.
 * Bundled by vite into dist/scripts/content-recorder.js and injected
 * by the service worker via chrome.scripting.executeScript.
 *
 * The SW passes tabId + startedAtMs via the init message. We retry
 * receiving it because executeScript can resolve before the listener
 * is registered on the other side.
 */

import { ContentRecorder } from './content-recorder.js';

const win = window as Window & { __waypointRecorder__?: ContentRecorder | undefined };

function sendEventsToSW(events: unknown[]) {
  try {
    chrome.runtime.sendMessage(
      { type: 'waypoint.recording.events', events },
      () => { void chrome.runtime.lastError; }
    );
  } catch {
    // Extension context invalidated (e.g., extension reloaded).
  }
}

if (!win.__waypointRecorder__) {
  console.info('[Waypoint:recorder] Content recorder script loaded on', window.location.href);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'waypoint.recorder.init') {
      if (win.__waypointRecorder__) {
        console.info('[Waypoint:recorder] Already running, skipping init.');
        sendResponse({ ok: true, alreadyRunning: true });
        return false;
      }

      const tabId: string = message.tabId ?? 'unknown';
      const startedAtMs: number = message.startedAtMs ?? Date.now();
      console.info('[Waypoint:recorder] Init received. tabId:', tabId, 'startedAtMs:', startedAtMs);

      const recorder = new ContentRecorder({
        tabId,
        startedAtMs,
        onEvents(events) {
          console.info('[Waypoint:recorder] Flushing', events.length, 'event(s) to SW.');
          sendEventsToSW(events);
        }
      });

      recorder.start();
      win.__waypointRecorder__ = recorder;
      console.info('[Waypoint:recorder] Recorder started. Listening for DOM events.');

      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'waypoint.recorder.stop') {
      console.info('[Waypoint:recorder] Stop received. Disposing.');
      if (win.__waypointRecorder__) {
        win.__waypointRecorder__.dispose();
        win.__waypointRecorder__ = undefined;
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // Notify the SW that the recorder script is loaded and ready for init.
  try {
    console.info('[Waypoint:recorder] Sending content-recorder-ready to SW.');
    chrome.runtime.sendMessage(
      { type: 'waypoint.content-recorder-ready' },
      () => { void chrome.runtime.lastError; }
    );
  } catch {
    // Extension context invalidated.
  }
} else {
  console.info('[Waypoint:recorder] Already loaded, skipping re-init.');
}
