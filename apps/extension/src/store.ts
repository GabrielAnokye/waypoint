import { create } from 'zustand';

import type {
  AuthProfile,
  AuthProfileStatus,
  RunStepResult,
  RunSummary,
  Schedule,
  WorkflowRecord
} from '@waypoint/shared-types';

// ---- State types ----

export type ExtensionStatus = 'idle' | 'checking' | 'ready' | 'error';
export type RecordingState = 'idle' | 'recording' | 'stopping';
export type PanelView = 'workflows' | 'run-detail' | 'workflow-editor' | 'profiles' | 'schedules' | 'settings';

export interface ActiveRun {
  runId: string;
  workflowId: string;
  status: string;
  currentStepIndex: number;
  currentStepLabel: string;
  steps: RunStepResult[];
  startedAt: string;
  error?: string;
}

export interface ProfileWithStatus extends AuthProfile {
  status: AuthProfileStatus;
}

// ---- Store shape ----

interface ExtensionStore {
  // Connection
  status: ExtensionStatus;
  lastMessage: string;
  setStatus: (status: ExtensionStatus, lastMessage: string) => void;

  // Recording
  recordingState: RecordingState;
  recordingId: string | undefined;
  eventCount: number;
  rerecordContext: { workflowId: string; fromStepIndex: number } | undefined;
  setRecordingState: (state: RecordingState) => void;
  setRecordingId: (id: string | undefined) => void;
  setEventCount: (count: number) => void;
  setRerecordContext: (ctx: { workflowId: string; fromStepIndex: number } | undefined) => void;

  // Navigation
  view: PanelView;
  setView: (view: PanelView) => void;
  selectedRunId: string | undefined;
  setSelectedRunId: (id: string | undefined) => void;
  selectedWorkflowId: string | undefined;
  setSelectedWorkflowId: (id: string | undefined) => void;

  // Workflows (normalized by id)
  workflows: Record<string, WorkflowRecord>;
  workflowOrder: string[];
  setWorkflows: (list: WorkflowRecord[]) => void;
  updateWorkflowInStore: (workflow: WorkflowRecord) => void;
  removeWorkflow: (id: string) => void;

  // Runs (normalized by id)
  runs: Record<string, RunSummary>;
  runOrder: string[];
  setRuns: (list: RunSummary[]) => void;
  updateRun: (run: RunSummary) => void;

  // Active run (live execution state)
  activeRun: ActiveRun | undefined;
  setActiveRun: (run: ActiveRun | undefined) => void;

  // Auth profiles
  profiles: Record<string, ProfileWithStatus>;
  profileOrder: string[];
  setProfiles: (list: ProfileWithStatus[]) => void;
  removeProfile: (id: string) => void;

  // Schedules
  schedules: Record<string, Schedule>;
  scheduleOrder: string[];
  setSchedules: (list: Schedule[]) => void;
  updateScheduleInStore: (schedule: Schedule) => void;
  removeSchedule: (id: string) => void;

  // Loading states
  loading: Record<string, boolean>;
  setLoading: (key: string, value: boolean) => void;
}

function normalize<T extends { id: string }>(
  list: T[]
): { map: Record<string, T>; order: string[] } {
  const map: Record<string, T> = {};
  const order: string[] = [];
  for (const item of list) {
    map[item.id] = item;
    order.push(item.id);
  }
  return { map, order };
}

export const useExtensionStore = create<ExtensionStore>((set) => ({
  // Connection
  status: 'idle',
  lastMessage: 'Extension ready.',
  setStatus: (status, lastMessage) => set({ status, lastMessage }),

  // Recording
  recordingState: 'idle',
  recordingId: undefined,
  eventCount: 0,
  rerecordContext: undefined,
  setRecordingState: (recordingState) => set({ recordingState }),
  setRecordingId: (recordingId) => set({ recordingId }),
  setEventCount: (eventCount) => set({ eventCount }),
  setRerecordContext: (rerecordContext) => set({ rerecordContext }),

  // Navigation
  view: 'workflows',
  setView: (view) => set({ view }),
  selectedRunId: undefined,
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  selectedWorkflowId: undefined,
  setSelectedWorkflowId: (selectedWorkflowId) => set({ selectedWorkflowId }),

  // Workflows
  workflows: {},
  workflowOrder: [],
  setWorkflows: (list) => {
    const { map, order } = normalize(list);
    set({ workflows: map, workflowOrder: order });
  },
  updateWorkflowInStore: (workflow) =>
    set((s) => ({
      workflows: { ...s.workflows, [workflow.id]: workflow },
      workflowOrder: s.workflowOrder.includes(workflow.id)
        ? s.workflowOrder
        : [workflow.id, ...s.workflowOrder]
    })),
  removeWorkflow: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.workflows;
      return { workflows: rest, workflowOrder: s.workflowOrder.filter((x) => x !== id) };
    }),

  // Runs
  runs: {},
  runOrder: [],
  setRuns: (list) => {
    const map: Record<string, RunSummary> = {};
    const order: string[] = [];
    for (const r of list) {
      map[r.id] = r;
      order.push(r.id);
    }
    set({ runs: map, runOrder: order });
  },
  updateRun: (run) =>
    set((s) => ({
      runs: { ...s.runs, [run.id]: run },
      runOrder: s.runOrder.includes(run.id)
        ? s.runOrder
        : [run.id, ...s.runOrder]
    })),

  // Active run
  activeRun: undefined,
  setActiveRun: (activeRun) => set({ activeRun }),

  // Profiles
  profiles: {},
  profileOrder: [],
  setProfiles: (list) => {
    const map: Record<string, ProfileWithStatus> = {};
    const order: string[] = [];
    for (const p of list) {
      map[p.id] = p;
      order.push(p.id);
    }
    set({ profiles: map, profileOrder: order });
  },
  removeProfile: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.profiles;
      return { profiles: rest, profileOrder: s.profileOrder.filter((x) => x !== id) };
    }),

  // Schedules
  schedules: {},
  scheduleOrder: [],
  setSchedules: (list) => {
    const map: Record<string, Schedule> = {};
    const order: string[] = [];
    for (const s of list) {
      map[s.id] = s;
      order.push(s.id);
    }
    set({ schedules: map, scheduleOrder: order });
  },
  updateScheduleInStore: (schedule) =>
    set((s) => ({
      schedules: { ...s.schedules, [schedule.id]: schedule },
      scheduleOrder: s.scheduleOrder.includes(schedule.id)
        ? s.scheduleOrder
        : [schedule.id, ...s.scheduleOrder]
    })),
  removeSchedule: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.schedules;
      return { schedules: rest, scheduleOrder: s.scheduleOrder.filter((x) => x !== id) };
    }),

  // Loading
  loading: {},
  setLoading: (key, value) =>
    set((s) => ({ loading: { ...s.loading, [key]: value } }))
}));
