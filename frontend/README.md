# BLE Web Tool Frontend

Vue/Vite frontend source for the BLE web tool.

## Commands

```powershell
npm install
npm run dev
npm run build
```

Development proxy:

- Vite runs on `http://127.0.0.1:5173`.
- `/api/*` is proxied to the Go backend at `http://127.0.0.1:51888`.

Production build output is written to `../web`, which is still the static directory served by the Go application.
