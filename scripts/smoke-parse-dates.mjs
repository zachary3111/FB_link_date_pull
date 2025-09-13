import { parseLooseDate, _test__relativeTo } from "../src/utils/postTime.js";

const now = new Date("2025-09-13T12:00:00+08:00");
const rel = (s) => parseLooseDate(s, { now });

const cases = [
  ["Just now", "2025-09-13T12:00:00+08:00"],
  ["1m", "2025-09-13T11:59:00+08:00"],
  ["2 h", "2025-09-13T10:00:00+08:00"],
  ["Yesterday at 3:45 PM", "2025-09-12T15:45:00+08:00"],
  ["September 13 at 2:34 PM", "2025-09-13T14:34:00+08:00"],
];

const failed = [];
for (const [input, expected] of cases) {
  const got = rel(input);
  if (!got || got !== expected) failed.push({ input, expected, got });
}

if (failed.length) {
  console.error("SMOKE FAIL:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log("SMOKE OK:", cases.length, "cases");