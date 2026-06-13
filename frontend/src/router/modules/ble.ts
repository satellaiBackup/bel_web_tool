const Layout = () => import("@/layout/index.vue");

export default {
  path: "/ble",
  name: "Ble",
  component: Layout,
  redirect: "/ble/workbench",
  meta: {
    icon: "ep/connection",
    title: "BLE 工具",
    rank: 1
  },
  children: [
    {
      path: "/ble/workbench",
      name: "BleWorkbench",
      component: () => import("@/views/ble/workbench.vue"),
      meta: {
        title: "调试工作台",
        keepAlive: true
      }
    }
  ]
} satisfies RouteConfigsTable;
