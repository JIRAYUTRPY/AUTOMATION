import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages are bundled into standalone output.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@automation/shared'],
  poweredByHeader: false,
};

export default config;
