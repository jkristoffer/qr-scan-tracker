import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const buildHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_HASH: buildHash,
  },
};

export default nextConfig;
