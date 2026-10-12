// nextgit-platform — auto-land engagement interlock (AD-11 / FR-26).
//
// The one seam that owns "is auto-land allowed to run, and may this
// land proceed". Response-free and env-free policy (mirrors judge.ts's
// pure-policy posture; no I/O, no binding access — binding reads stay
// in index.ts). Imports nothing (no circular import; AUTO_LAND_ENGAGED
// has exactly one definition site).

/**
 * Auto-land engagement switch (AD-11 / FR-26): OFF by default and
 * record-gated. It may only be ON when the calibration record
 * (porting/calibration/judge-v1/calibration-record.json) passes
 * record-check (porting/calibration/engagement-check.mjs enforces
 * this at deploy/verification time). The switch is a code constant —
 * never an env var, never a client flag (AD-11: state is assembled
 * server-side; caller-supplied gate flags are prohibited).
 */
export const AUTO_LAND_ENGAGED = false;

/**
 * Eligibility predicate (record-gated engagement).
 * True ONLY when AUTO_LAND_ENGAGED is true AND the calibration
 * record passes record-check (exists, spike passes, sign-off
 * present). Engagement cannot ship without the record.
 * Pure: takes the record-check outcome as a boolean so the policy
 * stays testable without touching the filesystem (the deploy/verify
 * path runs record-check.mjs — see engagement-check.mjs; at runtime
 * the constant IS the gate, so the route passes its known outcome).
 */
export function autoLandEligible(recordCheckPassed: boolean): boolean {
 return AUTO_LAND_ENGAGED && recordCheckPassed;
}

/**
 * Non-model corroboration interlock (AD-11: "the judge advises,
 * code decides"; a favorable judge verdict alone never auto-lands).
 * `merge` is the computeMerge result for the requested repos/ref.
 * True when at least one non-model corroborating signal is CLEAN:
 * fold status === "clean" AND an empty conflict map (conflicted
 * === [] and no file row with result "conflict"). A non-empty
 * conflict map or unclean fold status blocks the auto-land
 * regardless of the judge's answers.
 */
export function hasCleanCorroboratingSignal(merge: {
 status: string;
 conflicted: readonly string[];
 files: ReadonlyArray<{ result: string }>;
}): boolean {
 return (
  merge.status === "clean" &&
  merge.conflicted.length === 0 &&
  !merge.files.some((f) => f.result === "conflict")
 );
}
