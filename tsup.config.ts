import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

export default defineConfig([
  {
    entry: { index: 'src/index.ts', react: 'src/react.ts', vue: 'src/vue.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'es2020',
    external: ['react', 'vue'],
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    define: { 'process.env.QRFORGE_VERSION': JSON.stringify(version) },
  },
])
