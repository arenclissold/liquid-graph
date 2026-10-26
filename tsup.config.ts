import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', chartjs: 'src/chartjs.ts', tanstack: 'src/tanstack.ts', recharts: 'src/recharts.ts' }, external: ['chart.js'], format: ['esm', 'cjs'], dts: true,
  sourcemap: true, clean: true, target: 'es2020', splitting: false,
});
