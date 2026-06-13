const Layout = () => import("@/layout/index.vue");

export default {
  path: "/nmea",
  name: "Nmea",
  component: Layout,
  redirect: "/nmea/workbench",
  meta: {
    icon: "ep/location",
    title: "NMEA 工具",
    rank: 2
  },
  children: [
    {
      path: "/nmea/workbench",
      name: "NmeaWorkbench",
      component: () => import("@/views/nmea/index.vue"),
      meta: {
        title: "生成与回放",
        keepAlive: true
      }
    }
  ]
} satisfies RouteConfigsTable;
