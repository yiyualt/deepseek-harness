import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const emfConverter = resolve(import.meta.dirname, 'src/vendor/emf-converter/index.mjs')

export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [{
    name: 'dsh-genoffice-emf-converter',
    resolveId(source: string) {
      if (source !== './vendor/emf-converter/index.mjs') return null
      return emfConverter
    },
  }],
})
