export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrate } = await import('./lib/migrate');
    const retryDelays = [0, 250, 1_000];
    let lastError: unknown;

    for (const delay of retryDelays) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await migrate();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    // A temporary database outage must not prevent the application process
    // from starting. Data routes will continue to fail closed until the
    // database recovers, and the next cold start will retry migrations.
    console.error('Database migration unavailable after retries', lastError);
  }
}
