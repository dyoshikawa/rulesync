export const isEnvTest = process.env.NODE_ENV === "test";

export function getVitestWorkerId(): string {
  const vitestWorkerId = process.env.VITEST_WORKER_ID;
  if (!vitestWorkerId) {
    throw new Error("VITEST_WORKER_ID is not set");
  }
  return vitestWorkerId;
}
