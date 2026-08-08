import type {
  BoundedLogResult,
  DeviceActionPolicy,
  SafetyDecision,
  SafetySessionState
} from "./safetyState";

export type LegacyHandler = (...args: unknown[]) => unknown;

export interface LegacySafetyController {
  decide: (policy: DeviceActionPolicy) => SafetyDecision;
  assertAllowed: (policy: DeviceActionPolicy) => void;
  applyDomPolicy: () => void;
  sanitizeLogText: (input: unknown) => string;
  appendBoundedLog: (current: string, incoming: unknown) => BoundedLogResult;
  reportBlocked: (decision: SafetyDecision) => void;
  getState: () => SafetySessionState;
}

export type LegacyWindow = Window &
  Record<string, LegacyHandler | LegacySafetyController | undefined> & {
    __bleWorkbenchSafety?: LegacySafetyController;
  };

export type ModuleId =
  | "maintenanceSection"
  | "commandConsoleSection"
  | "communicationSection"
  | "positioningSection"
  | "wifiCommandsSection"
  | "c1DockProvisioningSection";

export interface ModuleTab {
  id: ModuleId;
  label: string;
  title: string;
  description: string;
}

export interface LegacyBridge {
  call: (name: string, ...args: unknown[]) => void;
  callAsync: <T = unknown>(
    name: string,
    ...args: unknown[]
  ) => Promise<T | null>;
  callWithElement: (name: string, elementId: string) => void;
  clearPanel: (id: string) => void;
  focusLog: (id: string) => void;
  sendAppCommand: (command: string) => void;
  sendFactoryCommand: (buttonId: string) => void;
}
