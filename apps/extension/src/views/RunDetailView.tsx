import { useCallback, useEffect, useState } from 'react';

import type { Artifact, RunStepResult } from '@waypoint/shared-types';

import { api } from '../api';
import { useExtensionStore } from '../store';

const FAILURE_LABELS: Record<string, string> = {
  locator_not_found: 'Element not found',
  ambiguous_locator: 'Multiple elements matched',
  timeout: 'Timed out',
  navigation_mismatch: 'Navigation error',
  auth_expired: 'Authentication expired',
  frame_mismatch: 'Frame structure changed',
  blocked_page: 'Page blocked (captcha/access denied)',
  modal_blocked: 'Blocked by modal/dialog',
  step_failed: 'Step execution failed',
  unknown: 'Unknown error'
};

function classifyFailure(code?: string): { label: string; suggestion: string } {
  if (!code) return { label: 'Unknown', suggestion: '' };
  const label = FAILURE_LABELS[code] ?? code;
  const suggestions: Record<string, string> = {
    locator_not_found: 'Try rebinding the element in the workflow editor.',
    ambiguous_locator: 'Multiple elements match. Add a more specific locator via the editor.',
    timeout: 'Increase timeout or check if the page loads correctly.',
    navigation_mismatch: 'The URL may have changed. Update the goto step URL.',
    auth_expired: 'Re-authenticate via the auth profile login session.',
    frame_mismatch: 'The iframe structure may have changed. Rebind the element.',
    blocked_page: 'The site may require manual intervention (captcha, access).',
    modal_blocked: 'A dialog is blocking. Add a dismiss step before this one.',
    step_failed: 'Check the step configuration and try testing it individually.'
  };
  return { label, suggestion: suggestions[code] ?? '' };
}

export function RunDetailView() {
  const { selectedRunId, setView, setStatus, setSelectedWorkflowId } = useExtensionStore();
  const [run, setRun] = useState<{
    run: {
      id: string;
      workflowId: string;
      status: string;
      startedAt: string;
      finishedAt?: string;
      errorCode?: string;
      errorMessage?: string;
    };
    steps: RunStepResult[];
    artifacts: Artifact[];
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const fetchRun = useCallback(async () => {
    if (!selectedRunId) return;
    try {
      const graph = await api.getRunDetails(selectedRunId);
      setRun(graph as typeof run);
      if (graph.run.status === 'running') {
        setPolling(true);
      } else {
        setPolling(false);
      }
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Failed to load run.');
    }
  }, [selectedRunId, setStatus]);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(() => void fetchRun(), 2000);
    return () => clearInterval(interval);
  }, [polling, fetchRun]);

  const handleExportDiagnostics = async () => {
    if (!selectedRunId) return;
    setExporting(true);
    try {
      const bundle = await api.getRunDiagnostics(selectedRunId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagnostics-${selectedRunId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('ready', 'Diagnostics bundle exported.');
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  if (!selectedRunId) {
    return (
      <section className="wp-card">
        <p className="wp-message">No run selected.</p>
        <button className="wp-button" onClick={() => setView('workflows')}>
          Back
        </button>
      </section>
    );
  }

  async function handleCancel() {
    if (!selectedRunId) return;
    try {
      await api.cancelRun(selectedRunId);
      void fetchRun();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Cancel failed.');
    }
  }

  const statusColor = (s: string) => {
    if (s === 'succeeded') return '#087443';
    if (s === 'failed') return '#8a1c26';
    if (s === 'running') return '#8c5c00';
    return '#687582';
  };

  const stepArtifacts = (stepId: string) =>
    run?.artifacts.filter((a) => a.runStepResultId === stepId) ?? [];

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="wp-button"
          onClick={() => setView('workflows')}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          Back
        </button>
        <div style={{ flex: 1 }} />
        {run && (
          <>
            <button
              className="wp-button"
              onClick={() => {
                setSelectedWorkflowId(run.run.workflowId);
                setView('workflow-editor');
              }}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              Edit workflow
            </button>
            <button
              className="wp-button"
              onClick={() => void handleExportDiagnostics()}
              disabled={exporting}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              {exporting ? 'Exporting...' : 'Export diagnostics'}
            </button>
          </>
        )}
      </div>

      {!run ? (
        <p className="wp-message">Loading...</p>
      ) : (
        <>
          {/* Run summary */}
          <section className="wp-card">
            <p className="wp-label">Run {run.run.id.slice(0, 20)}</p>
            <p
              className="wp-status"
              style={{ color: statusColor(run.run.status) }}
            >
              {run.run.status}
            </p>
            <div className="wp-grid">
              <div>
                <p className="wp-label">Started</p>
                <p className="wp-value">
                  {new Date(run.run.startedAt).toLocaleString()}
                </p>
              </div>
              {run.run.finishedAt && (
                <div>
                  <p className="wp-label">Finished</p>
                  <p className="wp-value">
                    {new Date(run.run.finishedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Root cause classification */}
            {run.run.errorCode && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  borderRadius: 6,
                  background: 'rgba(138,28,38,0.06)',
                  border: '1px solid rgba(138,28,38,0.15)'
                }}
              >
                <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 13, color: '#8a1c26' }}>
                  {classifyFailure(run.run.errorCode).label}
                </p>
                {run.run.errorMessage && (
                  <p style={{ margin: '0 0 4px', fontSize: 12, color: '#8a1c26' }}>
                    {run.run.errorMessage}
                  </p>
                )}
                {classifyFailure(run.run.errorCode).suggestion && (
                  <p style={{ margin: 0, fontSize: 11, color: '#446074', fontStyle: 'italic' }}>
                    {classifyFailure(run.run.errorCode).suggestion}
                  </p>
                )}
              </div>
            )}

            {run.run.status === 'running' && (
              <button
                className="wp-button wp-button--danger"
                onClick={() => void handleCancel()}
                style={{ marginTop: 8 }}
              >
                Cancel
              </button>
            )}
          </section>

          {/* Step timeline */}
          <section className="wp-card">
            <p className="wp-label">Steps ({run.steps.length})</p>
            {run.steps.length === 0 ? (
              <p className="wp-message">No steps recorded yet.</p>
            ) : (
              run.steps.map((step, i) => {
                const isExpanded = expandedStep === i;
                const arts = stepArtifacts(step.id);
                const failure = step.status === 'failed' ? classifyFailure(step.errorCode) : null;

                return (
                  <div
                    key={step.id}
                    style={{
                      padding: '6px 0',
                      borderBottom:
                        i < run.steps.length - 1
                          ? '1px solid rgba(68,96,116,0.1)'
                          : undefined
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer'
                      }}
                      onClick={() => setExpandedStep(isExpanded ? null : i)}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: statusColor(step.status),
                          flexShrink: 0
                        }}
                      />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {i + 1}. {step.stepType}
                      </span>
                      {step.attemptCount > 1 && (
                        <span style={{ fontSize: 10, color: '#8c5c00', fontWeight: 700 }}>
                          x{step.attemptCount}
                        </span>
                      )}
                      <span
                        style={{ fontSize: 12, color: '#687582', marginLeft: 'auto' }}
                      >
                        {step.durationMs != null ? `${step.durationMs}ms` : '...'}
                      </span>
                      <span style={{ fontSize: 11 }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 6, paddingLeft: 16, fontSize: 12 }}>
                        <div className="wp-grid" style={{ marginBottom: 6 }}>
                          <div>
                            <p className="wp-label">Step ID</p>
                            <p className="wp-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {step.stepId}
                            </p>
                          </div>
                          <div>
                            <p className="wp-label">Status</p>
                            <p className="wp-value" style={{ color: statusColor(step.status) }}>
                              {step.status}
                            </p>
                          </div>
                        </div>

                        {step.resolvedLocator && (
                          <div style={{ marginBottom: 4 }}>
                            <p className="wp-label">Resolved locator</p>
                            <p className="wp-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {step.resolvedLocator.kind}: {JSON.stringify(step.resolvedLocator).slice(0, 80)}
                            </p>
                          </div>
                        )}

                        {failure && (
                          <div
                            style={{
                              padding: 6,
                              borderRadius: 4,
                              background: 'rgba(138,28,38,0.06)',
                              marginBottom: 4
                            }}
                          >
                            <p style={{ margin: 0, fontWeight: 600, color: '#8a1c26', fontSize: 12 }}>
                              {failure.label}
                            </p>
                            {step.errorMessage && (
                              <p style={{ margin: '2px 0 0', color: '#8a1c26', fontSize: 11 }}>
                                {step.errorMessage}
                              </p>
                            )}
                            {failure.suggestion && (
                              <p style={{ margin: '2px 0 0', color: '#446074', fontSize: 11, fontStyle: 'italic' }}>
                                {failure.suggestion}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Debug metadata */}
                        {step.debug && (step.debug.notes.length > 0 || step.debug.tags.length > 0) && (
                          <details style={{ fontSize: 11, color: '#687582', marginBottom: 4 }}>
                            <summary style={{ cursor: 'pointer' }}>Debug info</summary>
                            {step.debug.confidence != null && (
                              <p style={{ margin: '2px 0' }}>Confidence: {(step.debug.confidence * 100).toFixed(0)}%</p>
                            )}
                            {step.debug.notes.length > 0 && (
                              <p style={{ margin: '2px 0' }}>Notes: {step.debug.notes.join(', ')}</p>
                            )}
                            {step.debug.tags.length > 0 && (
                              <p style={{ margin: '2px 0' }}>Tags: {step.debug.tags.join(', ')}</p>
                            )}
                          </details>
                        )}

                        {/* Step artifacts */}
                        {arts.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <p className="wp-label">Artifacts</p>
                            {arts.map((a) => (
                              <p key={a.id} className="wp-message" style={{ fontSize: 11 }}>
                                {a.kind}: {a.path}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* All artifacts */}
          {run.artifacts.length > 0 && (
            <section className="wp-card">
              <p className="wp-label">All artifacts ({run.artifacts.length})</p>
              {run.artifacts.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0' }}>
                  <span style={{ fontWeight: 600, minWidth: 70 }}>{a.kind}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#446074', flex: 1 }}>
                    {a.path}
                  </span>
                  <span style={{ fontSize: 11, color: '#687582' }}>
                    {a.sizeBytes > 0 ? `${(a.sizeBytes / 1024).toFixed(1)}KB` : ''}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
