// tools/normalize.mjs — delivery loudness normalization for the rendered master.
// Two-pass loudnorm to -14 LUFS / TP -1.5 dBTP, video stream copied (no re-encode).
// Keeps the pre-normalization master at renders/video.prenorm.mp4.
// usage: node tools/normalize.mjs [renders/video.mp4]
import { copyFileSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";

const inPath = process.argv[2] ?? "renders/video.mp4";
const pre = inPath.replace(/\.mp4$/, ".prenorm.mp4");
copyFileSync(inPath, pre);
console.log("pre-norm master kept at", pre);

const measure = spawnSync("ffmpeg", ["-hide_banner", "-i", inPath, "-af",
  "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const m = measure.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s);
if (!m) { console.error("measure failed:\n", measure.stderr.slice(-800)); process.exit(1); }
const v = JSON.parse(m[0]);
console.log("measured:", v.input_i, "LUFS / TP", v.input_tp, "/ LRA", v.input_lra);

const tmp = inPath.replace(/\.mp4$/, ".norm.mp4");
const apply = spawnSync("ffmpeg", ["-y", "-hide_banner", "-i", inPath, "-af",
  `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`,
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", tmp], { encoding: "utf8" });
if (apply.status !== 0) { console.error("apply failed:\n", apply.stderr.slice(-800)); process.exit(1); }
renameSync(tmp, inPath);
console.log("normalized in place:", inPath);

const check = spawnSync("ffmpeg", ["-hide_banner", "-i", inPath, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
const keep = check.stderr.split("\n").filter((l) => /Summary|I:|Peak|LRA/.test(l));
console.log(keep.slice(-6).join("\n"));
