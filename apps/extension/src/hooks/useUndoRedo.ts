import { useCallback, useRef, useState } from 'react';

/**
 * Generic undo/redo hook backed by an immutable snapshot stack.
 * `maxHistory` caps memory usage; oldest entries are discarded.
 */
export function useUndoRedo<T>(initial: T, maxHistory = 50) {
  const [state, setState] = useState<T>(initial);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);

  const push = useCallback(
    (next: T) => {
      setState((prev) => {
        pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), prev];
        futureRef.current = [];
        return next;
      });
    },
    [maxHistory]
  );

  const undo = useCallback(() => {
    setState((prev) => {
      if (pastRef.current.length === 0) return prev;
      const previous = pastRef.current[pastRef.current.length - 1]!;
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [...futureRef.current, prev];
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (futureRef.current.length === 0) return prev;
      const next = futureRef.current[futureRef.current.length - 1]!;
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [...pastRef.current, prev];
      return next;
    });
  }, []);

  const reset = useCallback((value: T) => {
    pastRef.current = [];
    futureRef.current = [];
    setState(value);
  }, []);

  return {
    state,
    push,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0
  };
}
