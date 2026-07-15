import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const buildHash = (() => {
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelCommitSha) return vercelCommitSha.slice(0, 7);

  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (deploymentId) return deploymentId.replace(/^dpl_/, '').slice(-8);

  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return process.env.NODE_ENV === 'development' ? 'local' : 'unknown';
  }
})();

const nextConfig: NextConfig = {
  env: {
    BUILD_HASH: buildHash,
  },
};

export default nextConfig;
