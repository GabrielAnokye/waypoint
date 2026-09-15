const waypointWindow = window as Window & {
  __waypointInjected__?: boolean;
};

if (!waypointWindow.__waypointInjected__) {
  waypointWindow.__waypointInjected__ = true;

  chrome.runtime.sendMessage(
    {
      type: 'waypoint.content-script-ready',
      payload: {
        title: document.title,
        url: window.location.href
      }
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}
