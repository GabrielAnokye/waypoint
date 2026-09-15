import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locator, Workflow, WorkflowStep } from '@waypoint/shared-types';

import { api } from '../api';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useExtensionStore } from '../store';

// ---- Helpers ----

function stepLabel(step: WorkflowStep): string {
  if (step.label) return step.label;
  switch (step.type) {
    case 'goto': return `Go to ${step.url}`;
    case 'click': return `Click ${locatorSummary(step.primaryLocator)}`;
    case 'type': return `Type "${step.value.slice(0, 30)}${step.value.length > 30 ? '...' : ''}"`;
    case 'select': return `Select ${step.option.value}`;
    case 'press': return `Press ${step.modifiers.length ? step.modifiers.join('+') + '+' : ''}${step.key}`;
    case 'waitFor': return `Wait for ${step.condition}`;
    case 'assert': return `Assert ${step.assertion.kind}`;
    case 'newTab': return step.initialUrl ? `New tab → ${step.initialUrl}` : 'New tab';
    case 'closeTab': return 'Close tab';
  }
}

function locatorSummary(loc: Locator): string {
  switch (loc.kind) {
    case 'role': return `role:${loc.role}("${loc.name}")`;
    case 'testId': return `testId:${loc.testId}`;
    case 'label': return `label:"${loc.label}"`;
    case 'placeholder': return `placeholder:"${loc.placeholder}"`;
    case 'text': return `text:"${loc.text}"`;
    case 'css': return `css:${loc.selector.slice(0, 40)}`;
    case 'xpath': return `xpath:${loc.selector.slice(0, 40)}`;
    case 'coordinates': return `(${loc.x},${loc.y})`;
  }
}

function locatorKindLabel(kind: Locator['kind']): string {
  const labels: Record<Locator['kind'], string> = {
    role: 'Role', testId: 'Test ID', label: 'Label', placeholder: 'Placeholder',
    text: 'Text', css: 'CSS', xpath: 'XPath', coordinates: 'Coordinates'
  };
  return labels[kind];
}

function cloneSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return JSON.parse(JSON.stringify(steps)) as WorkflowStep[];
}

// ---- Step Editor Panel ----

interface StepEditorProps {
  step: WorkflowStep;
  index: number;
  onChange: (index: number, step: WorkflowStep) => void;
  onTest: (index: number) => void;
  onRunFrom: (index: number) => void;
  onRerecordFrom: (index: number) => void;
  onRebind: (index: number) => void;
  testingStep: number | null;
}

function StepEditor({ step, index, onChange, onTest, onRunFrom, onRerecordFrom, onRebind, testingStep }: StepEditorProps) {
  const [expanded, setExpanded] = useState(false);

  const update = (partial: Partial<WorkflowStep>) => {
    onChange(index, { ...step, ...partial } as WorkflowStep);
  };

  const hasLocator = 'primaryLocator' in step && step.primaryLocator;

  return (
    <div
      className="wp-card"
      style={{
        opacity: step.enabled === false ? 0.5 : 1,
        borderLeft: `3px solid ${step.enabled === false ? '#687582' : '#0d5b86'}`
      }}
    >
      {/* Step header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: '#0d5b86', minWidth: 22 }}>
          {index + 1}.
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{stepLabel(step)}</span>
        <span style={{ fontSize: 11, color: '#687582' }}>{step.type}</span>
        <span style={{ fontSize: 12 }}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          {/* Enable/disable */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={step.enabled !== false}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Enabled
          </label>

          {/* Label */}
          <FieldRow label="Label">
            <input
              type="text"
              value={step.label ?? ''}
              onChange={(e) => update({ label: e.target.value || undefined })}
              placeholder="Optional step label"
              className="wp-input"
            />
          </FieldRow>

          {/* Type-specific fields */}
          {step.type === 'goto' && (
            <FieldRow label="URL">
              <input
                type="text"
                value={step.url}
                onChange={(e) => onChange(index, { ...step, url: e.target.value } as WorkflowStep)}
                className="wp-input"
              />
            </FieldRow>
          )}

          {step.type === 'type' && (
            <>
              <FieldRow label="Value">
                <input
                  type="text"
                  value={step.value}
                  onChange={(e) => onChange(index, { ...step, value: e.target.value } as WorkflowStep)}
                  className="wp-input"
                />
              </FieldRow>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={step.clearBefore}
                  onChange={(e) => onChange(index, { ...step, clearBefore: e.target.checked } as WorkflowStep)}
                />
                Clear before typing
              </label>
            </>
          )}

          {step.type === 'press' && (
            <FieldRow label="Key">
              <input
                type="text"
                value={step.key}
                onChange={(e) => onChange(index, { ...step, key: e.target.value } as WorkflowStep)}
                className="wp-input"
              />
            </FieldRow>
          )}

          {step.type === 'select' && (
            <FieldRow label={`Option (by ${step.option.by})`}>
              <input
                type="text"
                value={String(step.option.value)}
                onChange={(e) =>
                  onChange(index, {
                    ...step,
                    option: { ...step.option, value: step.option.by === 'index' ? Number(e.target.value) : e.target.value }
                  } as WorkflowStep)
                }
                className="wp-input"
              />
            </FieldRow>
          )}

          {step.type === 'waitFor' && (
            <FieldRow label="Condition">
              <select
                value={step.condition}
                onChange={(e) => onChange(index, { ...step, condition: e.target.value } as WorkflowStep)}
                className="wp-input"
              >
                {['visible', 'hidden', 'attached', 'detached', 'enabled', 'disabled'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FieldRow>
          )}

          {step.type === 'newTab' && (
            <FieldRow label="Initial URL">
              <input
                type="text"
                value={step.initialUrl ?? ''}
                onChange={(e) => onChange(index, { ...step, initialUrl: e.target.value || undefined } as WorkflowStep)}
                className="wp-input"
              />
            </FieldRow>
          )}

          {/* Timeout */}
          <FieldRow label="Timeout (ms)">
            <input
              type="number"
              value={step.timeoutMs}
              min={1000}
              max={120000}
              step={1000}
              onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
              className="wp-input"
              style={{ width: 90 }}
            />
          </FieldRow>

          {/* Retry policy */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <FieldRow label="Max attempts">
              <input
                type="number"
                value={step.retryPolicy.maxAttempts}
                min={1}
                max={10}
                onChange={(e) =>
                  update({
                    retryPolicy: { ...step.retryPolicy, maxAttempts: Number(e.target.value) }
                  })
                }
                className="wp-input"
                style={{ width: 50 }}
              />
            </FieldRow>
            <FieldRow label="Backoff (ms)">
              <input
                type="number"
                value={step.retryPolicy.backoffMs}
                min={0}
                max={30000}
                step={250}
                onChange={(e) =>
                  update({
                    retryPolicy: { ...step.retryPolicy, backoffMs: Number(e.target.value) }
                  })
                }
                className="wp-input"
                style={{ width: 70 }}
              />
            </FieldRow>
            <FieldRow label="Strategy">
              <select
                value={step.retryPolicy.strategy}
                onChange={(e) =>
                  update({
                    retryPolicy: { ...step.retryPolicy, strategy: e.target.value as 'fixed' | 'exponential' }
                  })
                }
                className="wp-input"
              >
                <option value="fixed">Fixed</option>
                <option value="exponential">Exponential</option>
              </select>
            </FieldRow>
          </div>

          {/* Locator inspector */}
          {hasLocator && (
            <LocatorInspector
              primary={step.primaryLocator}
              fallbacks={'fallbackLocators' in step ? step.fallbackLocators ?? [] : []}
              onChange={(primary, fallbacks) =>
                onChange(index, { ...step, primaryLocator: primary, fallbackLocators: fallbacks } as WorkflowStep)
              }
            />
          )}

          {/* Debug metadata */}
          {step.debug && (
            <details style={{ fontSize: 11, color: '#687582' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Debug metadata</summary>
              <div style={{ marginTop: 4 }}>
                {step.debug.confidence != null && (
                  <p style={{ margin: '2px 0' }}>Confidence: {(step.debug.confidence * 100).toFixed(0)}%</p>
                )}
                {step.debug.rawEventType && (
                  <p style={{ margin: '2px 0' }}>Source event: {step.debug.rawEventType}</p>
                )}
                {step.debug.sourceUrl && (
                  <p style={{ margin: '2px 0' }}>Source URL: {step.debug.sourceUrl}</p>
                )}
                {step.debug.notes.length > 0 && (
                  <p style={{ margin: '2px 0' }}>Notes: {step.debug.notes.join(', ')}</p>
                )}
                {step.debug.tags.length > 0 && (
                  <p style={{ margin: '2px 0' }}>Tags: {step.debug.tags.join(', ')}</p>
                )}
              </div>
            </details>
          )}

          {/* Step actions */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              className="wp-button"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => onTest(index)}
              disabled={testingStep !== null}
            >
              {testingStep === index ? 'Testing...' : 'Test this step'}
            </button>
            <button
              className="wp-button"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => onRunFrom(index)}
            >
              Run from here
            </button>
            <button
              className="wp-button"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => onRerecordFrom(index)}
            >
              Re-record from here
            </button>
            {hasLocator && (
              <button
                className="wp-button"
                style={{ fontSize: 11, padding: '4px 8px', background: '#446074' }}
                onClick={() => onRebind(index)}
              >
                Rebind element
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Locator Inspector ----

function LocatorInspector({
  primary,
  fallbacks,
  onChange
}: {
  primary: Locator;
  fallbacks: Locator[];
  onChange: (primary: Locator, fallbacks: Locator[]) => void;
}) {
  const all = [primary, ...fallbacks];
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const promote = (i: number) => {
    if (i === 0) return;
    const newAll = [...all];
    const promoted = newAll.splice(i, 1)[0]!;
    newAll.unshift(promoted);
    onChange(newAll[0]!, newAll.slice(1));
  };

  return (
    <div style={{ border: '1px solid rgba(68,96,116,0.15)', borderRadius: 8, padding: 8 }}>
      <p className="wp-label" style={{ margin: '0 0 4px' }}>Locators</p>
      {all.map((loc, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 0',
            fontSize: 12,
            borderBottom: i < all.length - 1 ? '1px solid rgba(68,96,116,0.08)' : undefined
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: i === 0 ? '#0d5b86' : '#687582',
              minWidth: 50
            }}
          >
            {i === 0 ? 'PRIMARY' : `#${i + 1}`}
          </span>
          <span style={{ fontWeight: 600, minWidth: 45 }}>{locatorKindLabel(loc.kind)}</span>
          {editingIndex === i ? (
            <LocatorValueEditor
              locator={loc}
              onSave={(updated) => {
                const newAll = [...all];
                newAll[i] = updated;
                onChange(newAll[0]!, newAll.slice(1));
                setEditingIndex(null);
              }}
              onCancel={() => setEditingIndex(null)}
            />
          ) : (
            <>
              <span style={{ flex: 1, color: '#223445', fontFamily: 'monospace', fontSize: 11 }}>
                {locatorSummary(loc)}
              </span>
              <button
                onClick={() => setEditingIndex(i)}
                style={{ background: 'none', border: 'none', color: '#0d5b86', cursor: 'pointer', fontSize: 11, padding: 0 }}
              >
                Edit
              </button>
              {i > 0 && (
                <button
                  onClick={() => promote(i)}
                  style={{ background: 'none', border: 'none', color: '#446074', cursor: 'pointer', fontSize: 11, padding: 0 }}
                >
                  Promote
                </button>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function LocatorValueEditor({
  locator,
  onSave,
  onCancel
}: {
  locator: Locator;
  onSave: (loc: Locator) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(
    locator.kind === 'role' ? locator.name :
    locator.kind === 'testId' ? locator.testId :
    locator.kind === 'label' ? locator.label :
    locator.kind === 'placeholder' ? locator.placeholder :
    locator.kind === 'text' ? locator.text :
    locator.kind === 'css' ? locator.selector :
    locator.kind === 'xpath' ? locator.selector :
    ''
  );

  const save = () => {
    let updated: Locator;
    switch (locator.kind) {
      case 'role': updated = { ...locator, name: value }; break;
      case 'testId': updated = { kind: 'testId', testId: value }; break;
      case 'label': updated = { kind: 'label', label: value }; break;
      case 'placeholder': updated = { kind: 'placeholder', placeholder: value }; break;
      case 'text': updated = { ...locator, text: value }; break;
      case 'css': updated = { kind: 'css', selector: value }; break;
      case 'xpath': updated = { kind: 'xpath', selector: value }; break;
      case 'coordinates': updated = locator; break;
    }
    onSave(updated);
  };

  return (
    <span style={{ display: 'flex', gap: 4, flex: 1 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="wp-input"
        style={{ flex: 1, fontSize: 11 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <button onClick={save} style={{ background: 'none', border: 'none', color: '#087443', cursor: 'pointer', fontSize: 11 }}>
        Save
      </button>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#8a1c26', cursor: 'pointer', fontSize: 11 }}>
        Cancel
      </button>
    </span>
  );
}

// ---- Field row ----

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#446074' }}>{label}</label>
      {children}
    </div>
  );
}

// ---- Main Editor View ----

export function WorkflowEditorView() {
  const { selectedWorkflowId, setView, setStatus, setSelectedRunId, setRerecordContext, setRecordingState, setRecordingId, setEventCount } = useExtensionStore();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingStep, setTestingStep] = useState<number | null>(null);
  const [rebindingStep, setRebindingStep] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const {
    state: steps,
    push: pushSteps,
    undo,
    redo,
    reset: resetSteps,
    canUndo,
    canRedo
  } = useUndoRedo<WorkflowStep[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const savedRef = useRef<string>('');
  const isDirty = workflow !== null && JSON.stringify({ name, description, steps }) !== savedRef.current;

  // Load workflow
  useEffect(() => {
    if (!selectedWorkflowId) return;
    void (async () => {
      try {
        setLoading(true);
        const { workflow: wf } = await api.getWorkflowDefinition(selectedWorkflowId);
        setWorkflow(wf);
        setName(wf.name);
        setDescription(wf.description ?? '');
        resetSteps(cloneSteps(wf.steps));
        savedRef.current = JSON.stringify({ name: wf.name, description: wf.description ?? '', steps: wf.steps });
      } catch (err) {
        setStatus('error', err instanceof Error ? err.message : 'Failed to load workflow.');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedWorkflowId, resetSteps, setStatus]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // Unsaved changes guard
  const handleBack = useCallback(() => {
    if (isDirty) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    setView('workflows');
  }, [isDirty, setView]);

  // Validation
  const validate = useCallback((): string[] => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Workflow name is required.');
    if (steps.length === 0) errors.push('At least one step is required.');
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.type === 'goto' && !s.url) errors.push(`Step ${i + 1}: URL is required.`);
      if (s.type === 'type' && s.value === '') errors.push(`Step ${i + 1}: Value cannot be empty.`);
      if (s.type === 'press' && !s.key) errors.push(`Step ${i + 1}: Key is required.`);
      if (s.timeoutMs < 1000) errors.push(`Step ${i + 1}: Timeout must be >= 1000ms.`);
    }
    return errors;
  }, [name, steps]);

  // Save
  const handleSave = async () => {
    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    try {
      const result = await api.updateWorkflowDefinition(selectedWorkflowId!, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : { description: '' }),
        steps,
        changeSummary: 'Updated via workflow editor'
      });
      setWorkflow(result.workflow);
      savedRef.current = JSON.stringify({ name: name.trim(), description: description.trim(), steps });
      setStatus('ready', `Saved v${result.workflowVersion}.`);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // Step modifications
  const handleStepChange = (index: number, updated: WorkflowStep) => {
    const next = cloneSteps(steps);
    next[index] = updated;
    pushSteps(next);
  };

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const next = cloneSteps(steps);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    pushSteps(next);
  };

  const deleteStep = (index: number) => {
    const next = cloneSteps(steps);
    next.splice(index, 1);
    pushSteps(next);
  };

  // Test step
  const handleTestStep = async (index: number) => {
    if (!selectedWorkflowId) return;
    setTestingStep(index);
    try {
      const result = await api.testStep(selectedWorkflowId, steps[index]!);
      if (result.ok) {
        setStatus('ready', `Step ${index + 1} passed (${result.durationMs}ms).`);
      } else {
        setStatus('error', `Step ${index + 1} failed: ${result.error?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Test failed.');
    } finally {
      setTestingStep(null);
    }
  };

  // Run from step
  const handleRunFrom = async (index: number) => {
    if (!selectedWorkflowId) return;
    // Save first if dirty
    if (isDirty) {
      const errors = validate();
      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }
      await handleSave();
    }
    try {
      const result = await api.runFromStep(selectedWorkflowId, index);
      setStatus('ready', `Run started from step ${index + 1}.`);
      setSelectedRunId(result.runId);
      setView('run-detail');
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Run failed.');
    }
  };

  // Re-record from step — sets splice context so stopRecording knows to splice
  const handleRerecordFrom = async (index: number) => {
    if (!selectedWorkflowId) return;
    try {
      setRerecordContext({ workflowId: selectedWorkflowId, fromStepIndex: index });
      setRecordingState('recording');
      setEventCount(0);
      const response = await api.startRecording(`Re-record from step ${index + 1}`);
      if (response.ok && response.payload) {
        setRecordingId(response.payload.recordingId);
        setStatus('ready', `Recording started. Navigate to the page and perform actions from step ${index + 1}.`);
        setView('workflows');
      } else {
        setRerecordContext(undefined);
        setRecordingState('idle');
        setStatus('error', response.message ?? 'Failed to start recording.');
      }
    } catch (err) {
      setRerecordContext(undefined);
      setRecordingState('idle');
      setStatus('error', err instanceof Error ? err.message : 'Re-record failed.');
    }
  };

  // Rebind element
  const handleRebind = async (index: number) => {
    setRebindingStep(index);
    setStatus('ready', `Click an element on the page to rebind step ${index + 1}. The content script will capture the new selectors.`);

    // Send a message to the SW to enter rebind mode
    try {
      const response = await new Promise<{ ok: boolean; payload?: { target: unknown } }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'waypoint.rebind-element', stepIndex: index },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false });
            } else {
              resolve(res ?? { ok: false });
            }
          }
        );
      });

      if (response.ok && response.payload?.target) {
        const target = response.payload.target as { primaryLocator: Locator; fallbackLocators: Locator[] };
        const step = steps[index]!;
        if ('primaryLocator' in step) {
          const updated = {
            ...step,
            primaryLocator: target.primaryLocator,
            fallbackLocators: target.fallbackLocators
          } as WorkflowStep;
          handleStepChange(index, updated);
          setStatus('ready', `Step ${index + 1} rebound to new element.`);
        }
      } else {
        setStatus('error', 'Rebind cancelled or no element selected.');
      }
    } catch {
      setStatus('error', 'Rebind failed. Make sure a page is active.');
    } finally {
      setRebindingStep(null);
    }
  };

  if (!selectedWorkflowId) {
    return (
      <section className="wp-card">
        <p className="wp-message">No workflow selected.</p>
        <button className="wp-button" onClick={() => setView('workflows')}>Back</button>
      </section>
    );
  }

  if (loading) return <p className="wp-message">Loading workflow...</p>;

  return (
    <>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="wp-button" onClick={handleBack} style={{ fontSize: 12, padding: '4px 10px' }}>
          Back
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="wp-button"
          onClick={undo}
          disabled={!canUndo}
          style={{ fontSize: 11, padding: '4px 8px', opacity: canUndo ? 1 : 0.4 }}
          title="Undo (Cmd+Z)"
        >
          Undo
        </button>
        <button
          className="wp-button"
          onClick={redo}
          disabled={!canRedo}
          style={{ fontSize: 11, padding: '4px 8px', opacity: canRedo ? 1 : 0.4 }}
          title="Redo (Cmd+Shift+Z)"
        >
          Redo
        </button>
        <button
          className="wp-button"
          onClick={() => void handleSave()}
          disabled={saving || !isDirty}
          style={{ fontSize: 12, padding: '4px 12px' }}
        >
          {saving ? 'Saving...' : isDirty ? 'Save *' : 'Saved'}
        </button>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <section
          className="wp-card"
          style={{ borderColor: 'rgba(138,28,38,0.3)', background: 'rgba(138,28,38,0.06)' }}
        >
          {validationErrors.map((e, i) => (
            <p key={i} className="wp-message" style={{ color: '#8a1c26', margin: '2px 0', fontSize: 12 }}>{e}</p>
          ))}
        </section>
      )}

      {/* Workflow metadata */}
      <section className="wp-card">
        <FieldRow label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="wp-input"
          />
        </FieldRow>
        <FieldRow label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="wp-input"
            rows={2}
            style={{ resize: 'vertical' }}
          />
        </FieldRow>
      </section>

      {/* Steps */}
      <section>
        <p className="wp-label" style={{ margin: '0 0 6px' }}>
          Steps ({steps.length})
          {rebindingStep !== null && (
            <span style={{ color: '#8c5c00', marginLeft: 8, fontWeight: 400, textTransform: 'none' }}>
              — Rebinding step {rebindingStep + 1}...
            </span>
          )}
        </p>
        {steps.map((step, i) => (
          <div key={step.id} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <button
                onClick={() => moveStep(i, i - 1)}
                disabled={i === 0}
                style={{ background: 'none', border: 'none', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1, fontSize: 14, padding: 0 }}
                title="Move up"
              >
                &#9650;
              </button>
              <button
                onClick={() => moveStep(i, i + 1)}
                disabled={i === steps.length - 1}
                style={{ background: 'none', border: 'none', cursor: i === steps.length - 1 ? 'not-allowed' : 'pointer', opacity: i === steps.length - 1 ? 0.3 : 1, fontSize: 14, padding: 0 }}
                title="Move down"
              >
                &#9660;
              </button>
              <div style={{ flex: 1 }}>
                <StepEditor
                  step={step}
                  index={i}
                  onChange={handleStepChange}
                  onTest={(idx) => void handleTestStep(idx)}
                  onRunFrom={(idx) => void handleRunFrom(idx)}
                  onRerecordFrom={(idx) => void handleRerecordFrom(idx)}
                  onRebind={(idx) => void handleRebind(idx)}
                  testingStep={testingStep}
                />
              </div>
              <button
                onClick={() => deleteStep(i)}
                style={{
                  background: 'none', border: 'none', color: '#8a1c26', cursor: 'pointer',
                  fontSize: 16, fontWeight: 700, padding: 0, lineHeight: 1
                }}
                title="Delete step"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
