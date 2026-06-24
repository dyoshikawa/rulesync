export function isEnvTest(): boolean {
  return process.env.NODE_ENV === "test";
}
