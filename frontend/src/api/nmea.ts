import { http } from "@/utils/http";

export const sentenceTypes = ["GGA", "RMC", "GSA", "GSV", "VTG", "GST", "GLL"];

export const sentenceLabels: Record<string, string> = {
  GGA: "GGA 定位",
  RMC: "RMC 推荐最小",
  GSA: "GSA 精度",
  GSV: "GSV 卫星",
  VTG: "VTG 速度",
  GST: "GST 误差",
  GLL: "GLL 经纬度"
};

export interface SerialConfig {
  portName: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: number;
}

export interface SerialStatus extends SerialConfig {
  open: boolean;
}

export interface GeneratorSettings {
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  satellites: number;
  sendIntervalMs: number;
  sentenceOrder: string[];
  sentenceEnabled: Record<string, boolean>;
}

export interface ReplaySettings {
  replaySpeed: number;
  loopPlayback: boolean;
  updateTimestamp: boolean;
}

export interface RuntimeStatus {
  running: boolean;
  mode: string;
  startedAt?: string;
}

export interface NmeaRecord {
  timestamp: string;
  sentences: string[];
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  hasValidPosition: boolean;
}

export interface ReplayStatus {
  loaded: boolean;
  fileName?: string;
  recordCount: number;
  currentIndex: number;
  currentRecord?: NmeaRecord;
}

export interface ToolConfig {
  serial: SerialConfig;
  generator: GeneratorSettings;
  replay: ReplaySettings;
}

export interface ToolState {
  config: ToolConfig;
  serial: SerialStatus;
  runtime: RuntimeStatus;
  replay: ReplayStatus;
  lastGenerated: string[];
}

export interface GenerateResponse {
  lines: string[];
  state: ToolState;
}

export const getNmeaPorts = () => {
  return http.request<{ ports: string[] }>("get", "/api/nmea/ports");
};

export const getNmeaState = () => {
  return http.request<ToolState>("get", "/api/nmea/state");
};

export const updateNmeaConfig = (data: ToolConfig) => {
  return http.request<ToolState>("post", "/api/nmea/config", { data });
};

export const openNmeaSerial = (data: SerialConfig) => {
  return http.request<ToolState>("post", "/api/nmea/serial/open", { data });
};

export const closeNmeaSerial = () => {
  return http.request<ToolState>("post", "/api/nmea/serial/close");
};

export const generateNmea = (data: GeneratorSettings) => {
  return http.request<GenerateResponse>("post", "/api/nmea/generate", { data });
};

export const startNmea = (data: GeneratorSettings) => {
  return http.request<ToolState>("post", "/api/nmea/start", { data });
};

export const stopNmea = () => {
  return http.request<ToolState>("post", "/api/nmea/stop");
};

export const loadNmeaReplay = (data: { fileName: string; content: string }) => {
  return http.request<ToolState>("post", "/api/nmea/replay/load", { data });
};

export const startNmeaReplay = (data: ReplaySettings) => {
  return http.request<ToolState>("post", "/api/nmea/replay/start", { data });
};

export const stopNmeaReplay = () => {
  return http.request<ToolState>("post", "/api/nmea/replay/stop");
};
