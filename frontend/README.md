# BLE Web Tool Frontend

The frontend is now based on the `pure-admin-thin` scaffold from the
`vue-pure-admin` ecosystem.

## Commands

```powershell
npm install
npm run dev
npm run type-check
npm run build
```

## Local Development

- Vite runs on `http://127.0.0.1:5173`.
- `/api/*` is proxied to the Go backend at `http://127.0.0.1:51888`.
- The app opens directly to `/#/ble/workbench`.

## Build Output

Production assets are written to `../web`, which is the static directory served
by the Go application.

## Current BLE Page

The original BLE console is mounted as a legacy workbench page under the new
admin layout. Keep future business work inside Vue views/components and shrink
the legacy layer over time.
