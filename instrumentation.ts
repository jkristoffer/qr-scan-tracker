export async function migrateWithRetry(
  migrate: () => Promise<void>,
  retryDelays = [0, 250, 1_000],
  sleep = (delay: number) => new Promise<void>(resolve => setTimeout(resolve, delay)),
) {
  let lastError: unknown;

  for (const delay of retryDelays) {
    if (delay) await sleep(delay);
    try {
      await migrate();
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrate } = await import('./lib/migrate');
    await migrateWithRetry(migrate);
  }
}
