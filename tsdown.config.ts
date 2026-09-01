import { defineConfig } from 'tsdown'

/**
 * dsh-bioinf-verify ships one fused bundle (`lib/index.js`); declarations come
 * from `tsc -b` (dts: false), matching every package.
 *
 * schemastery + dsh-tools are fused into the bundle (deps.alwaysBundle) so the
 * published artifact is self-contained: a standalone `dsh plugin add` install
 * needs no runtime companions other than cordis, which every profile already
 * provides.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    alwaysBundle: ['@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery'],
  },
})
