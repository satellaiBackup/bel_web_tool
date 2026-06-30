<template>
  <el-config-provider :locale="currentLocale">
    <router-view />
    <ReDialog />
    <div class="build-stamp" :title="`Frontend build: ${buildTime}`">
      Build {{ buildTime }}
    </div>
  </el-config-provider>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { ElConfigProvider } from "element-plus";
import { ReDialog } from "@/components/ReDialog";
import zhCn from "element-plus/es/locale/lang/zh-cn";

export default defineComponent({
  name: "app",
  components: {
    [ElConfigProvider.name]: ElConfigProvider,
    ReDialog
  },
  computed: {
    currentLocale() {
      return zhCn;
    },
    buildTime() {
      return __APP_INFO__.lastBuildTime;
    }
  }
});
</script>

<style lang="scss" scoped>
.build-stamp {
  position: fixed;
  right: 12px;
  bottom: 8px;
  z-index: 3000;
  max-width: calc(100vw - 24px);
  padding: 3px 8px;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  color: rgba(31, 41, 55, 0.78);
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 4px;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

html.dark .build-stamp {
  color: rgba(226, 232, 240, 0.82);
  background: rgba(17, 24, 39, 0.78);
  border-color: rgba(71, 85, 105, 0.65);
}
</style>
