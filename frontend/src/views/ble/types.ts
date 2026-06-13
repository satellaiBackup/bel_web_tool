export type LegacyHandler = (...args: unknown[]) => unknown;

export type LegacyWindow = Window & Record<string, LegacyHandler | undefined>;

export type ModuleId =
  | "maintenanceSection"
  | "commandConsoleSection"
  | "communicationSection"
  | "positioningSection"
  | "wifiCommandsSection";

export interface ModuleTab {
  id: ModuleId;
  label: string;
  title: string;
  description: string;
}

export interface LegacyBridge {
  call: (name: string, ...args: unknown[]) => void;
  callWithElement: (name: string, elementId: string) => void;
  clearPanel: (id: string) => void;
  focusLog: (id: string) => void;
  sendAppCommand: (command: string) => void;
  sendFactoryCommand: (buttonId: string) => void;
}
