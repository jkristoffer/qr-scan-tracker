'use client';

import { AuthGuard } from '@/components/AuthGuard';
import { Dashboard } from '@/components/Dashboard';

export default function HomePage() {
  return (
    <AuthGuard>
      {user => <Dashboard user={user} />}
    </AuthGuard>
  );
}
