import { readFile } from "node:fs/promises";

export async function loadPolicy(policyPath) {
  const contents = await readFile(policyPath, "utf8");
  return JSON.parse(contents);
}
