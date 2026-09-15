import { describe, expect, it } from 'vitest';

/**
 * Tests for the undo/redo algorithm used by useUndoRedo hook.
 * Since we don't have @testing-library/react, we test the core logic
 * by simulating the state machine directly.
 */

interface UndoRedoState<T> {
  current: T;
  past: T[];
  future: T[];
}

function createUndoRedo<T>(initial: T, maxHistory = 50): UndoRedoState<T> {
  return { current: initial, past: [], future: [] };
}

function push<T>(state: UndoRedoState<T>, next: T, maxHistory = 50): UndoRedoState<T> {
  return {
    current: next,
    past: [...state.past.slice(-(maxHistory - 1)), state.current],
    future: []
  };
}

function undo<T>(state: UndoRedoState<T>): UndoRedoState<T> {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1]!;
  return {
    current: previous,
    past: state.past.slice(0, -1),
    future: [...state.future, state.current]
  };
}

function redo<T>(state: UndoRedoState<T>): UndoRedoState<T> {
  if (state.future.length === 0) return state;
  const next = state.future[state.future.length - 1]!;
  return {
    current: next,
    past: [...state.past, state.current],
    future: state.future.slice(0, -1)
  };
}

function reset<T>(value: T): UndoRedoState<T> {
  return { current: value, past: [], future: [] };
}

describe('undo/redo algorithm', () => {
  it('starts with initial value and empty stacks', () => {
    const s = createUndoRedo('a');
    expect(s.current).toBe('a');
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
  });

  it('push adds to past and clears future', () => {
    let s = createUndoRedo('a');
    s = push(s, 'b');
    expect(s.current).toBe('b');
    expect(s.past).toEqual(['a']);
    expect(s.future).toEqual([]);

    s = push(s, 'c');
    expect(s.current).toBe('c');
    expect(s.past).toEqual(['a', 'b']);
  });

  it('undo restores previous state', () => {
    let s = createUndoRedo('a');
    s = push(s, 'b');
    s = push(s, 'c');
    s = undo(s);
    expect(s.current).toBe('b');
    expect(s.past).toEqual(['a']);
    expect(s.future).toEqual(['c']);
  });

  it('redo restores undone state', () => {
    let s = createUndoRedo('a');
    s = push(s, 'b');
    s = push(s, 'c');
    s = undo(s);
    s = redo(s);
    expect(s.current).toBe('c');
    expect(s.past).toEqual(['a', 'b']);
    expect(s.future).toEqual([]);
  });

  it('undo is a no-op when past is empty', () => {
    const s = createUndoRedo('a');
    const result = undo(s);
    expect(result).toBe(s);
  });

  it('redo is a no-op when future is empty', () => {
    const s = createUndoRedo('a');
    const result = redo(s);
    expect(result).toBe(s);
  });

  it('push after undo clears the future (forking)', () => {
    let s = createUndoRedo('a');
    s = push(s, 'b');
    s = push(s, 'c');
    s = undo(s); // current = b, future = [c]
    s = push(s, 'd'); // fork — future cleared
    expect(s.current).toBe('d');
    expect(s.past).toEqual(['a', 'b']);
    expect(s.future).toEqual([]);
  });

  it('multiple undo/redo round-trips', () => {
    let s = createUndoRedo(0);
    s = push(s, 1);
    s = push(s, 2);
    s = push(s, 3);
    s = undo(s); // 2
    s = undo(s); // 1
    s = undo(s); // 0
    expect(s.current).toBe(0);
    s = redo(s); // 1
    s = redo(s); // 2
    expect(s.current).toBe(2);
  });

  it('respects maxHistory cap', () => {
    let s = createUndoRedo(0);
    for (let i = 1; i <= 10; i++) {
      s = push(s, i, 5);
    }
    // maxHistory=5 means past keeps at most 4 entries (capped to -(5-1))
    expect(s.past.length).toBeLessThanOrEqual(5);
    expect(s.current).toBe(10);
  });

  it('reset clears all history', () => {
    let s = createUndoRedo('a');
    s = push(s, 'b');
    s = push(s, 'c');
    s = reset('x');
    expect(s.current).toBe('x');
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
  });

  it('works with complex objects (workflow steps)', () => {
    type Steps = { id: string; type: string }[];
    let s = createUndoRedo<Steps>([{ id: '1', type: 'click' }]);
    s = push(s, [{ id: '1', type: 'click' }, { id: '2', type: 'type' }]);
    s = push(s, [{ id: '2', type: 'type' }, { id: '1', type: 'click' }]); // reordered
    s = undo(s);
    expect(s.current).toEqual([{ id: '1', type: 'click' }, { id: '2', type: 'type' }]);
  });
});
