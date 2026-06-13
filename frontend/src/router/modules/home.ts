const Layout = () => import("@/layout/index.vue");

export default {
  path: "/",
  name: "Home",
  component: Layout,
  redirect: "/ble/workbench",
  meta: {
    icon: "ep/home-filled",
    title: "首页",
    showLink: false,
    rank: 0
  },
  children: [
    {
      path: "/welcome",
      name: "Welcome",
      component: () => import("@/views/welcome/index.vue"),
      meta: {
        title: "首页",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
