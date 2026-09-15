import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import { useExtensionStore, type ProfileWithStatus } from '../store';

export function ProfilesView() {
  const { profiles, profileOrder, setProfiles, removeProfile, setStatus } =
    useExtensionStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const fetchProfiles = useCallback(async () => {
    try {
      const { profiles: list } = await api.listAuthProfiles();
      setProfiles(list as ProfileWithStatus[]);
    } catch {
      /* runner offline */
    }
  }, [setProfiles]);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      await api.createAuthProfile({ name: newName.trim(), browserEngine: 'chromium' });
      setNewName('');
      setCreating(false);
      void fetchProfiles();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Create failed.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAuthProfile(id);
      removeProfile(id);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function handleValidate(id: string) {
    try {
      const { valid, reason } = await api.validateAuthProfile(id);
      setStatus(
        valid ? 'ready' : 'error',
        valid ? 'Profile is valid.' : `Invalid: ${reason ?? 'unknown'}`
      );
      void fetchProfiles();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Validate failed.');
    }
  }

  async function handleLogin(id: string) {
    try {
      const result = await api.startLoginSession(id);
      setStatus('ready', result.message ?? `Login session: ${result.status}`);
      void fetchProfiles();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Login failed.');
    }
  }

  const statusColor = (s: string) => {
    if (s === 'valid') return '#087443';
    if (s === 'likely_expired') return '#8c5c00';
    if (s === 'invalid') return '#8a1c26';
    return '#687582';
  };

  return (
    <>
      <section className="wp-card">
        {creating ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Profile name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(68,96,116,0.3)',
                fontSize: 14
              }}
            />
            <button className="wp-button" onClick={() => void handleCreate()}>
              Create
            </button>
            <button
              className="wp-button"
              onClick={() => {
                setCreating(false);
                setNewName('');
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="wp-button"
            onClick={() => setCreating(true)}
            style={{ width: '100%' }}
          >
            New auth profile
          </button>
        )}
      </section>

      {profileOrder.length === 0 ? (
        <section className="wp-card">
          <p className="wp-message">No auth profiles. Create one to manage login sessions.</p>
        </section>
      ) : (
        profileOrder.map((id) => {
          const p = profiles[id];
          if (!p) return null;
          return (
            <section key={id} className="wp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="wp-label" style={{ margin: 0 }}>{p.name}</p>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: statusColor(p.status),
                    textTransform: 'uppercase'
                  }}
                >
                  {p.status.replace('_', ' ')}
                </span>
              </div>
              <p className="wp-message" style={{ fontSize: 12, marginTop: 4 }}>
                {p.browserEngine} &middot; {p.profileDirectory}
              </p>
              {p.notes && <p className="wp-message">{p.notes}</p>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="wp-button" onClick={() => void handleLogin(id)}>
                  Login
                </button>
                <button className="wp-button" onClick={() => void handleValidate(id)}>
                  Validate
                </button>
                <button
                  className="wp-button wp-button--danger"
                  onClick={() => {
                    if (confirm(`Delete "${p.name}"?`)) void handleDelete(id);
                  }}
                >
                  Delete
                </button>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
