/** Structured, single-line JSON logs -- readable directly in the GitHub
 * Actions run log, and easy to grep if ever piped elsewhere. */
export function log(level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  const entry = { level, message, ts: new Date().toISOString(), ...extra };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}
