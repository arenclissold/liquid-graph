# TanStack Charts and Recharts examples

From the repository root:

```sh
npm run build
cd examples/adapters
npm install
npm run dev
```

This separate demo installs React, Recharts 3.8+, and TanStack Charts 1.x. Both charts use the same three savings datasets, native scales, responsive sizing, and the shared Liquid Graph particle engine. Recharts keeps its native tooltip and accessibility layer; TanStack retains native scene interaction and focus. The TanStack example uses its default SVG host.

The main package does not import these hosts or React. The Recharts factory receives the application's React and Recharts instances once. The TanStack plugin attaches through the public `onRender` callback and must be destroyed alongside the host.

`npm run build` in this folder builds the adapter demo after dependencies are installed. A registry connection is required for the initial install.
