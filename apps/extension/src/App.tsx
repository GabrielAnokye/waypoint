import { useEffect } from 'react';

import { AppShell } from '@waypoint/ui';

import { api } from './api';
import { useExtensionStore, type PanelView } from './store';
import { ProfilesView } from './views/ProfilesView';
import { RunDetailView } from './views/RunDetailView';
import { SchedulesView } from './views/SchedulesView';
import { WorkflowEditorView } from './views/WorkflowEditorView';
import { WorkflowListView } from './views/WorkflowListView';

const TABS: { id: PanelView; label: string }[] = [
  { id: 'workflows', label: 'Workflows' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'schedules', label: 'Schedules' }
];

export function App() {
  const { status, lastMessage, setStatus, view, setView } = useExtensionStore();

  useEffect(() => {
    void (async () => {
      try {
        setStatus('checking', 'Pinging service worker.');
        const response = await api.ping();
        setStatus(
          response.ok ? 'ready' : 'error',
          response.ok
            ? 'Service worker reachable.'
            : response.message ?? 'Service worker did not reply.'
        );
      } catch (err) {
        setStatus(
          'error',
          err instanceof Error ? err.message : 'Service worker ping failed.'
        );
      }
    })();
  }, [setStatus]);

  return (
    <AppShell
      title="Waypoint"
      subtitle="Local-first browser automation."
      nav={
        TABS.map((tab) => (
          <button
            key={tab.id}
            className={`wp-tab${view === tab.id ? ' wp-tab--active' : ''}`}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))
      }
    >
      {/* Status bar */}
      {status === 'error' && (
        <section
          className="wp-card"
          style={{
            borderColor: 'rgba(138,28,38,0.3)',
            background: 'rgba(138,28,38,0.06)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8
          }}
        >
          <p
            className="wp-message"
            style={{
              color: '#8a1c26',
              margin: 0,
              flex: 1,
              fontSize: 12,
              lineHeight: 1.4,
              wordBreak: 'break-word'
            }}
          >
            {lastMessage.length > 160
              ? lastMessage.slice(0, 160) + '...'
              : lastMessage}
          </p>
          <button
            onClick={() => setStatus('idle', '')}
            style={{
              background: 'none',
              border: 'none',
              color: '#8a1c26',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14,
              padding: 0,
              lineHeight: 1,
              flexShrink: 0
            }}
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </section>
      )}

      {status === 'ready' && lastMessage && (
        <section
          className="wp-card"
          style={{
            borderColor: 'rgba(8,116,67,0.3)',
            background: 'rgba(8,116,67,0.06)'
          }}
        >
          <p
            className="wp-message"
            style={{ color: '#087443', margin: 0, fontSize: 12 }}
          >
            {lastMessage}
          </p>
        </section>
      )}

      {/* View router */}
      {view === 'workflows' && <WorkflowListView />}
      {view === 'workflow-editor' && <WorkflowEditorView />}
      {view === 'run-detail' && <RunDetailView />}
      {view === 'profiles' && <ProfilesView />}
      {view === 'schedules' && <SchedulesView />}
    </AppShell>
  );
}
