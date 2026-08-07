<script setup lang="ts">
import { computed } from "vue";
import type {
  SafetyDecision,
  SafetySessionState,
  SafetyStreamState,
  SafetyTaskState
} from "../safetyState";

defineOptions({
  name: "BleSafetyHeader"
});

const props = defineProps<{
  state: SafetySessionState;
  gateDecision: SafetyDecision;
  lastBlockedReason?: string;
}>();

const streamLabels: Record<SafetyStreamState, string> = {
  connecting: "事件流连接中",
  fresh: "事件流已对账",
  reconnecting: "事件流重连中",
  stale: "事件状态已过期",
  snapshot_syncing: "快照对账中",
  failed: "事件流不可用"
};

const taskLabels: Record<SafetyTaskState, string> = {
  idle: "无活动任务",
  queued: "任务排队中",
  sending: "任务发送中",
  accepted: "设备已受理，尚未完成",
  running: "任务执行中",
  cancelling: "任务取消中",
  succeeded: "任务成功",
  partial_succeeded: "任务部分成功",
  failed: "任务失败",
  timed_out: "任务超时",
  cancelled: "任务已取消",
  interrupted: "任务已中断",
  unknown_result: "任务结果未知"
};

const identityLabel = computed(() =>
  props.state.identity === "verified" ? "已核验" : "未核验"
);

const deviceDetail = computed(() => {
  if (props.state.identity !== "verified") {
    return "仅限制高风险操作";
  }
  return [
    props.state.device.model,
    props.state.device.firmware,
    props.state.device.protocol
  ]
    .filter(Boolean)
    .join(" · ");
});

const capabilitySummary = computed(() => {
  const values = Object.values(props.state.capabilities);
  const available = values.filter(item => item.state === "available").length;
  const unavailable = values.filter(
    item => item.state === "unavailable"
  ).length;
  const policyBlocked = values.filter(
    item => item.state === "policy_blocked"
  ).length;
  const pending = values.length - available - unavailable - policyBlocked;
  return `可用 ${available} · 不可用 ${unavailable} · 待确认 ${pending} · 策略锁定 ${policyBlocked}`;
});

const gateLabel = computed(() =>
  props.gateDecision.allowed ? "按能力开放" : "调试不可用"
);
</script>

<template>
  <section
    class="safety-status-bar"
    aria-label="会话状态与统一门禁"
    :data-gate-allowed="gateDecision.allowed"
  >
    <span
      class="safety-lock-badge"
      :data-allowed="gateDecision.allowed"
      :title="`门禁：${gateDecision.code} — ${lastBlockedReason || gateDecision.reason}`"
    >
      {{ gateLabel }}
    </span>

    <span class="safety-status-item" v-if="state.stream.state !== 'fresh'">
      <b>事件流</b>{{ streamLabels[state.stream.state] }}
    </span>

    <span class="safety-status-item" v-if="state.task.state !== 'idle'">
      <b>任务</b>{{ taskLabels[state.task.state] }}
    </span>

    <span
      class="safety-status-item"
      :data-state="state.identity"
      :title="deviceDetail"
    >
      <b>身份</b>{{ identityLabel }}
    </span>

    <span
      class="safety-status-item"
      :title="`能力：${capabilitySummary}`"
    >
      <b>能力</b>{{ capabilitySummary }}
    </span>

    <div
      id="ble-global-gate-reason"
      class="safety-gate-reason"
      :class="{ 'sr-only': gateDecision.allowed }"
      role="alert"
      aria-live="assertive"
    >
      <strong>{{ gateDecision.code }}</strong>
      <span>{{ lastBlockedReason || gateDecision.reason }}</span>
    </div>
  </section>
</template>
