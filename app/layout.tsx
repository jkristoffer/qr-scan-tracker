import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gate Scanner',
  description: 'Real-time ticket scanning for events',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

function getBuildInfo() {
  const buildHash = process.env.BUILD_HASH?.trim();
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();

  if (buildHash) {
    return {
      label: buildHash,
      description: `${commitSha ? `Git commit ${commitSha}` : `Build ${buildHash}`}${deploymentId ? ` · Deployment ${deploymentId}` : ''}`,
    };
  }

  if (commitSha) {
    return {
      label: commitSha.slice(0, 7),
      description: `Git commit ${commitSha}${deploymentId ? ` · Deployment ${deploymentId}` : ''}`,
    };
  }

  if (deploymentId) {
    return {
      label: deploymentId.replace(/^dpl_/, '').slice(-8),
      description: `Deployment ${deploymentId}`,
    };
  }

  const isLocal = process.env.NODE_ENV === 'development';
  return {
    label: isLocal ? 'local' : 'unknown',
    description: isLocal
      ? 'Local development build'
      : 'Deployment identifier unavailable; enable Vercel system environment variables',
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const build = getBuildInfo();

  return (
    <html lang="en" data-build={build.label}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <div
          className="no-print"
          aria-label={`Application build ${build.label}`}
          title={build.description}
          style={{
            position: 'fixed',
            top: '50%',
            right: 2,
            zIndex: 5,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 999,
            background: 'rgba(11,11,13,0.62)',
            color: 'rgba(255,255,255,0.72)',
            padding: '5px 2px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            writingMode: 'vertical-rl',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            userSelect: 'none',
            backdropFilter: 'blur(4px)',
          }}
        >
          Build {build.label}
        </div>
      </body>
    </html>
  );
}
