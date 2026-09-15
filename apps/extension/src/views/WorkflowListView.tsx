import { useCallback, useEffect, useRef } from 'react';

import { api } from '../api';
import { useExtensionStore } from '../store';

export function WorkflowListView() {
  const {
    workflows, workflowOrder, setWorkflows, updateWorkflowInStore, removeWorkflow,
    setView, setSelectedRunId, setSelectedWorkflowId,
    runs, setRuns,
    loading, setLoading,
    recordingState, recordingId, eventCount,
    rerecordContext, setRerecordContext,
    setRecordingState, setRecordingId, setEventCount, setStatus
  } = useExtensionStore();

  // Poll event count while recording.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (recordingState === 'recording') {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await api.getRecordingStatus();
          if (res.ok && res.payload) {
            setEventCount(res.payload.eventCount);
          }
        } catch { /* ignore */ }
      }, 1000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [recordingState, setEventCount]);

  const fetchWorkflows = useCallback(async () => {
    setLoading('workflows', true);
    try {
      const { workflows: list } = await api.listWorkflows();
      setWorkflows(list);
    } catch {
      /* silent — runner may be offline */
    } finally {
      setLoading('workflows', false);
    }
  }, [setWorkflows, setLoading]);

  const fetchRuns = useCallback(async () => {
    try {
      const { runs: list } = await api.listRuns();
      setRuns(list);
    } catch {
      /* silent */
    }
  }, [setRuns]);

  useEffect(() => {
    void fetchWorkflows();
    void fetchRuns();
  }, [fetchWorkflows, fetchRuns]);

  async function startRecording() {
    try {
      setRecordingState('recording');
      setEventCount(0);
      const response = await api.startRecording(
        `Recording ${new Date().toLocaleTimeString()}`
      );
      if (response.ok && response.payload) {
        setRecordingId(response.payload.recordingId);
        setStatus('ready', 'Recording started.');
      } else {
        setRecordingState('idle');
        setStatus('error', response.message ?? 'Failed to start recording.');
      }
    } catch (err) {
      setRecordingState('idle');
      setStatus('error', err instanceof Error ? err.message : 'Recording failed.');
    }
  }

  async function stopRecording() {
    try {
      setRecordingState('stopping');
      const response = await api.stopRecording();
      if (response.ok && response.payload) {
        const { recordingId: recId, name, startedAt, events, eventCount: count } = response.payload;
        setEventCount(count ?? 0);

        const spliceCtx = rerecordContext;
        setRerecordContext(undefined);

        try {
          if (spliceCtx) {
            // Splice: compile new events and replace steps from the given index
            const result = await api.spliceWorkflow(spliceCtx.workflowId, {
              fromStepIndex: spliceCtx.fromStepIndex,
              recording: { recordingId: recId, name, startedAt, events }
            });
            setRecordingState('idle');
            setStatus(
              'ready',
              `Workflow updated (v${result.workflowVersion}). ${result.stepsReplaced} step(s) replaced from step ${spliceCtx.fromStepIndex + 1}.`
            );
            void fetchWorkflows();
            // Navigate back to the editor for the updated workflow
            setSelectedWorkflowId(spliceCtx.workflowId);
            setView('workflow-editor');
          } else {
            // Normal: create a new workflow from the recording
            const result = await api.saveRecording({
              recordingId: recId,
              name,
              startedAt,
              events
            });
            setRecordingState('idle');
            setStatus('ready', `Workflow created (${result.workflowId}). ${count} event(s) compiled.`);
            void fetchWorkflows();
          }
        } catch (saveErr) {
          setRecordingState('idle');
          setStatus(
            'error',
            `Recording stopped (${count} events) but failed to save: ${saveErr instanceof Error ? saveErr.message : 'Unknown error'}. Is the runner running?`
          );
        }
      } else {
        setRecordingState('idle');
        setRerecordContext(undefined);
        setStatus('error', response.message ?? 'Failed to stop recording.');
      }
    } catch (err) {
      setRecordingState('idle');
      setRerecordContext(undefined);
      setStatus('error', err instanceof Error ? err.message : 'Stop failed.');
    }
  }

  async function handleRun(workflowId: string) {
    try {
      const { runId } = await api.runWorkflow(workflowId);
      setStatus('ready', `Run ${runId} started.`);
      void fetchRuns();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Run failed.');
    }
  }

  async function handleDelete(workflowId: string) {
    try {
      await api.deleteWorkflow(workflowId);
      removeWorkflow(workflowId);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function handleDuplicate(workflowId: string) {
    try {
      await api.duplicateWorkflow(workflowId);
      void fetchWorkflows();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Duplicate failed.');
    }
  }

  async function handleRename(workflowId: string, name: string) {
    try {
      const updated = await api.updateWorkflow(workflowId, { name });
      updateWorkflowInStore(updated);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Rename failed.');
    }
  }

  const recentRuns = (workflowId: string) =>
    Object.values(runs).filter((r) => r.workflowId === workflowId).slice(0, 3);

  return (
    <>
      {/* Recording controls */}
      <section className="wp-card">
        {recordingState === 'recording' ? (
          <>
            <p className="wp-label">Recording in progress</p>
            <p className="wp-value">{recordingId ?? '...'}</p>
            <p className="wp-message">Events: {eventCount}</p>
            <button
              className="wp-button wp-button--danger"
              onClick={() => void stopRecording()}
              style={{ marginTop: 8 }}
            >
              Stop recording
            </button>
          </>
        ) : (
          <button
            className="wp-button"
            onClick={() => void startRecording()}
            disabled={recordingState === 'stopping'}
            style={{ width: '100%' }}
          >
            {recordingState === 'stopping' ? 'Stopping...' : 'New recording'}
          </button>
        )}
      </section>

      {/* Workflow list */}
      {loading.workflows ? (
        <p className="wp-message">Loading workflows...</p>
      ) : workflowOrder.length === 0 ? (
        <section className="wp-card">
          <p className="wp-message">
            No workflows yet. Start a recording to create one.
          </p>
        </section>
      ) : (
        workflowOrder.map((id) => {
          const wf = workflows[id];
          if (!wf) return null;
          const wfRuns = recentRuns(id);
          return (
            <section key={id} className="wp-card">
              <p className="wp-label">{wf.name}</p>
              {wf.description && (
                <p className="wp-message" style={{ marginBottom: 8 }}>
                  {wf.description}
                </p>
              )}
              <div className="wp-grid" style={{ marginBottom: 8 }}>
                <div>
                  <p className="wp-label">Version</p>
                  <p className="wp-value">v{wf.latestVersion}</p>
                </div>
                <div>
                  <p className="wp-label">Updated</p>
                  <p className="wp-value">
                    {new Date(wf.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {wfRuns.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p className="wp-label">Recent runs</p>
                  {wfRuns.map((r) => (
                    <p
                      key={r.id}
                      className="wp-message"
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => {
                        setSelectedRunId(r.id);
                        setView('run-detail');
                      }}
                    >
                      {r.status} - {new Date(r.startedAt).toLocaleString()}
                    </p>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="wp-button"
                  onClick={() => void handleRun(id)}
                >
                  Run
                </button>
                <button
                  className="wp-button"
                  onClick={() => {
                    setSelectedWorkflowId(id);
                    setView('workflow-editor');
                  }}
                >
                  Edit
                </button>
                <button
                  className="wp-button"
                  onClick={() => {
                    const name = prompt('New name:', wf.name);
                    if (name && name !== wf.name) void handleRename(id, name);
                  }}
                >
                  Rename
                </button>
                <button
                  className="wp-button"
                  onClick={() => void handleDuplicate(id)}
                >
                  Duplicate
                </button>
                <button
                  className="wp-button wp-button--danger"
                  onClick={() => {
                    if (confirm(`Delete "${wf.name}"?`)) void handleDelete(id);
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
