#!/usr/bin/env python3
"""music/synth.py — the NextGit promo bed.

Deterministic, seek-free (rendered offline once): 120 BPM electro, 86.0 s
(= 43 bars exactly, so every storyboard frame boundary sits on the beat grid).
Sections are authored to the frames:
  0.0-6.5 cold open · 6.5-15 the mess · 15-21.5 meet (break) · 21.5-32 the set
  32-40 collision (half-time) · 40-46 judge · 46-58.5 secrets (sparse tech)
  58.5-64.5 signed · 64.5-73 review (lighter) · 73-80.5 ledger (wind-down)
  80.5-86 lockup (final resolve, fade)
Output: 48 kHz stereo WAV, sane headroom; loudnorm to -14 LUFS happens after.
"""
import wave
import numpy as np

SR = 48000
BPM = 120.0
BEAT = 60.0 / BPM
TOTAL = 86.0
N = int(SR * TOTAL)
rng = np.random.default_rng(20261015)

L = np.zeros(N)
R = np.zeros(N)

def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def add(t, sig, pan=0.0, gain=1.0):
    i = int(round(t * SR))
    if i >= N or sig.size == 0:
        return
    n = min(sig.size, N - i)
    gl = gain * (1.0 - max(0.0, pan)) ** 0.5
    gr = gain * (1.0 + min(0.0, pan)) ** 0.5
    L[i:i+n] += sig[:n] * gl
    R[i:i+n] += sig[:n] * gr

def t_arr(dur):
    return np.arange(int(round(dur * SR))) / SR

def env_ad(n, a, d, curve=2.0):
    """attack/decay envelope, n samples"""
    t = np.arange(n) / SR
    e = np.exp(-np.maximum(t - a, 0) / d)
    e[: int(a * SR)] *= np.linspace(0, 1, int(a * SR)) if a > 0 else 1
    return np.clip(e, 0, 1) ** (1.0 / curve)

# ---------------------------------------------------------------- instruments

def kick(dur=0.42, f0=120.0, f1=44.0, drop=0.06, amp=1.0):
    t = t_arr(dur)
    f = np.where(t < drop, f0 + (f1 - f0) * (t / drop), f1)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * env_ad(t.size, 0.001, 0.16, 1.6)
    click = rng.normal(0, 1, t.size) * np.exp(-t / 0.004) * 0.35
    return (body + click) * 0.9 * amp

def sub_note(freq, dur, amp=0.5):
    t = t_arr(dur)
    e = np.minimum(t / 0.02, 1) * np.exp(-np.maximum(t - dur * 0.75, 0) / (dur * 0.12))
    e = np.clip(e, 0, 1)
    return np.sin(2 * np.pi * freq * t) * e * amp

def hat(dur=0.06, open_=False, amp=0.32):
    d = 0.14 if open_ else dur
    t = t_arr(d)
    x = rng.normal(0, 1, t.size)
    # cheap high-pass: difference
    hp = np.diff(x, prepend=x[0])
    return hp * np.exp(-t / (0.05 if open_ else 0.012)) * amp

def snare(amp=0.4):
    t = t_arr(0.22)
    x = rng.normal(0, 1, t.size)
    bp = np.diff(x, prepend=x[0])
    tone = (np.sin(2*np.pi*190*t) + np.sin(2*np.pi*330*t)) * 0.3
    return (bp * 0.6 + tone) * np.exp(-t / 0.09) * amp

def clap(amp=0.34):
    t = t_arr(0.3)
    out = np.zeros_like(t)
    for k, off in enumerate([0.0, 0.008, 0.017, 0.027]):
        i = int(off * SR)
        seg = rng.normal(0, 1, t.size - i)
        out[i:] += seg * np.exp(-np.arange(seg.size) / SR / 0.02)
    out *= np.exp(-t / 0.12)
    return out * amp * 0.5

def pluck(freq, dur=0.35, amp=0.32):
    t = t_arr(dur)
    mod = 3.01
    idx = 2.5 * np.exp(-t / 0.08)
    sig = np.sin(2*np.pi*freq*t + idx*np.sin(2*np.pi*freq*mod*t))
    return sig * np.exp(-t / 0.14) * amp

def pad(freqs, dur, amp=0.16, lp=900.0):
    t = t_arr(dur)
    sig = np.zeros_like(t)
    for f in freqs:
        for det in (-0.004, 0.0, 0.004):
            sig += np.sin(2*np.pi*f*(1+det)*t + rng.uniform(0, 6.28))
    sig /= (len(freqs) * 3)
    # slow filter-open via one-pole
    a = np.clip(2*np.pi*lp/SR, 0, 1)
    y = np.zeros_like(sig)
    acc = 0.0
    for_ = sig
    # vector-ish one-pole (loop is fine offline; 86s worst case)
    for i in range(1, sig.size, 1):
        acc += a * (sig[i] - acc)
        y[i] = acc
    e = np.minimum(t / 0.9, 1) * np.minimum((dur - t) / 1.2, 1)
    return y * np.clip(e, 0, 1) * amp * 6.0

def riser(dur=2.0, amp=0.25):
    t = t_arr(dur)
    x = rng.normal(0, 1, t.size)
    # swept one-pole high-ish: amplitude ramps, then cut
    e = (t / dur) ** 2.2
    y = np.diff(x, prepend=x[0])
    return y * e * amp

def impact(amp=0.5):
    t = t_arr(1.1)
    f = 70 * np.exp(-t / 0.25)
    phase = 2*np.pi*np.cumsum(np.maximum(f, 34))/SR
    low = np.sin(phase) * np.exp(-t / 0.35)
    burst = rng.normal(0, 1, t.size) * np.exp(-t / 0.03)
    return (low * 1.0 + burst * 0.25) * amp

def tick(amp=0.16, f=2400.0):
    t = t_arr(0.03)
    return np.sin(2*np.pi*f*t) * np.exp(-t/0.006) * amp

# ---------------------------------------------------------------- note tables

A, C, D, E, F, G = 57, 60, 62, 64, 65, 67
def chord(root, kind="m9"):
    if kind == "m9":  return [hz(root), hz(root+3), hz(root+7), hz(root+10), hz(root+14)]
    if kind == "M7":  return [hz(root), hz(root+4), hz(root+7), hz(root+11)]
    if kind == "M9":  return [hz(root), hz(root+4), hz(root+7), hz(root+11), hz(root+14)]
    if kind == "6":   return [hz(root), hz(root+4), hz(root+7), hz(root+9)]
    return [hz(root), hz(root+7)]

beats_total = int(round(TOTAL / BEAT))  # 172

def in_section(t, a, b):
    return a <= t < b

# ---------------------------------------------------------------- arrangement

def groove(t0, t1, kick_pat, hat_pat, snare_pat=(), clap_pat=(), bass_pat=(), bass_notes=(), stabs=(), tick_pat=()):
    n = int(round((t1 - t0) / BEAT))
    for k in range(n):
        t = t0 + k * BEAT
        if k in kick_pat: add(t, kick(), 0.0, 0.95)
        if k in hat_pat: add(t, hat(open_=(k % 8 == 6)), 0.25, 0.8)
        if k in snare_pat: add(t, snare(), -0.1, 0.9)
        if k in clap_pat: add(t, clap(), 0.1, 0.9)
        if k in tick_pat: add(t, tick(), -0.3, 0.7)
        if bass_pat and k in bass_pat:
            note = bass_notes[(k // 8) % len(bass_notes)]
            add(t, sub_note(hz(note - 12), BEAT * 0.85, 0.5), 0.0, 0.9)
        if stabs and k in stabs:
            root, kind = stabs[0]
            pass  # stabs handled as short pads below per section

# chord bed: one pad per 4 s block through most of the film; discrete changes
prog = [(A,"m9"), (F,"M7"), (C,"M9"), (G,"6")]
b = 0.0
while b < TOTAL - 0.1:
    root, kind = prog[int(b // 4) % 4]
    seg_dur = min(4.0, TOTAL - b)
    if b >= 2.0:  # leave the very first 2 s bare for the cold open
        seg = pad(chord(root, kind), seg_dur + 0.3, amp=0.11)
        add(b, seg, 0.0, 1.0)
    b += 4.0

# --- Section: cold open (0-6.5)
add(0.0, sub_note(hz(A-24), 2.0, 0.35), 0.0, 0.8)
for k in (2, 6, 10):  # sparse pulse beats
    add(k*BEAT, sub_note(hz(A-24), 0.9, 0.4), 0.0, 0.8)
add(3.0, hat(open_=True, amp=0.2), 0.3, 0.7)
add(4.5, riser(2.0, 0.22), 0.0, 1.0)
for k in (8,10,12):
    add(k*BEAT, kick(0.36, amp=0.8), 0.0, 0.8)
add(6.5, impact(0.5), 0.0, 1.0)
add(6.5, kick(), 0.0, 1.0)

# --- Section: the mess (6.5-15)
groove(6.5, 15.0,
       kick_pat=set(range(0, 17)),           # 4-on-floor ×4 bars+
       hat_pat=set(range(0, 17, 2)),
       snare_pat={6, 14},
       bass_pat={0, 3, 4, 7, 8, 11, 12, 15},
       bass_notes=[A, A, F, G])
add(12.5, riser(2.5, 0.22), 0.0, 1.0)

# --- Section: meet / break (15-21.5)
add(15.0, impact(0.55), 0.0, 1.0)
groove(15.0, 21.5,
       kick_pat={4, 6, 12, 14},              # kick returns after a 2-beat break
       hat_pat=set(range(1, 13, 2)),
       clap_pat={6},
       bass_pat={0, 4, 8, 12},
       bass_notes=[A, F, C, G])
add(19.5, riser(2.0, 0.2), 0.0, 1.0)

# --- Section: the set (21.5-32)
add(21.5, impact(0.5), 0.0, 1.0)
groove(21.5, 32.0,
       kick_pat=set(range(0, 21)),
       hat_pat=set(range(0, 21, 2)),
       clap_pat={10, 18},
       bass_pat={0, 2, 3, 4, 6, 8, 10, 11, 12, 14, 16, 18, 19, 20},
       bass_notes=[A, F, C, G])
# pluck motif over the set
motif = [(23.0, 69), (23.5, 72), (24.0, 76), (24.75, 79), (25.5, 76), (26.5, 72), (27.5, 69),
         (29.0, 72), (29.5, 76), (30.0, 79), (30.75, 81), (31.5, 79)]
for t, m in motif:
    add(t, pluck(hz(m), 0.4, 0.22), 0.2, 0.9)

# --- Section: collision (32-40) half-time darker
add(32.0, impact(0.6), 0.0, 1.0)
groove(32.0, 40.0,
       kick_pat={0, 4, 8, 12},               # half-time
       hat_pat=set(range(1, 16, 4)),
       snare_pat={6, 14},
       bass_pat={0, 2, 4, 8, 10, 12},
       bass_notes=[A-2, A-2, F-2, G-2])
add(38.0, riser(2.0, 0.24), 0.0, 1.0)

# --- Section: judge (40-46) bright lift
add(40.0, impact(0.45), 0.0, 1.0)
groove(40.0, 46.0,
       kick_pat=set(range(0, 12)),
       hat_pat=set(range(0, 12, 2)),
       clap_pat={2, 6, 10},
       bass_pat={0, 4, 7, 8},
       bass_notes=[F, C, G, C])
for t, m in [(40.5, 77), (41.5, 81), (42.5, 84), (43.5, 79), (44.5, 84), (45.0, 88)]:
    add(t, pluck(hz(m), 0.4, 0.2), -0.2, 0.9)
add(44.0, riser(2.0, 0.2), 0.0, 1.0)

# --- Section: secrets (46-58.5) sparse tech
add(46.0, impact(0.5), 0.0, 1.0)
groove(46.0, 58.5,
       kick_pat={0, 8, 16},
       hat_pat=set(range(0, 25, 2)),
       tick_pat=set(range(1, 25, 4)),
       bass_pat={0, 4, 8, 12, 16, 20},
       bass_notes=[A-2, A-2, F-2, F-2, C-2, G-2])
for t, m in [(47.0, 64), (48.5, 67), (50.0, 72), (52.0, 67), (53.5, 64), (55.0, 62), (56.5, 60)]:
    add(t, pluck(hz(m), 0.5, 0.18), 0.25, 0.9)
add(56.5, riser(2.0, 0.26), 0.0, 1.0)

# --- Section: signed (58.5-64.5)
add(58.5, impact(0.6), 0.0, 1.0)
groove(58.5, 64.5,
       kick_pat=set(range(0, 12)),
       hat_pat=set(range(0, 12, 2)),
       clap_pat={10},
       bass_pat={0, 2, 4, 6, 8, 10},
       bass_notes=[C, C, G, G])
add(58.5, pad([hz(C+12), hz(C+19), hz(C+24)], 2.0, amp=0.1), 0.0, 1.0)

# --- Section: review (64.5-73) lighter
groove(64.5, 73.0,
       kick_pat={0, 4, 8, 12, 16},
       hat_pat=set(range(2, 17, 4)),
       snare_pat={6},
       bass_pat={0, 8},
       bass_notes=[F, F, C, C])
for t, m in [(65.5, 72), (66.5, 76), (67.5, 79), (69.0, 76), (70.0, 72), (71.0, 76), (72.0, 79)]:
    add(t, pluck(hz(m), 0.45, 0.16), 0.3, 0.85)

# --- Section: ledger (73-80.5) wind-down
groove(73.0, 80.5,
       kick_pat={0, 8, 16},
       hat_pat=set(range(4, 15, 4)),
       bass_pat={0, 8},
       bass_notes=[A, F, C, G])
add(78.5, riser(2.0, 0.24), 0.0, 1.0)

# --- Section: lockup (80.5-86)
add(80.5, impact(0.7), 0.0, 1.0)
add(80.5, pad(chord(C, "M9"), 5.0, amp=0.14), 0.0, 1.0)
for k in (0, 4, 8):
    add(80.5 + k*BEAT, kick(0.4), 0.0, 0.8)
add(82.5, sub_note(hz(C-12), 3.0, 0.35), 0.0, 0.8)

# ---------------------------------------------------------------- master

master = np.stack([L, R], axis=1)
# gentle saturation + fade in/out
master = np.tanh(master * 1.1) / 1.1
n_in, n_out = int(0.25*SR), int(2.6*SR)
master[:n_in] *= np.linspace(0, 1, n_in)[:, None]
master[-n_out:] *= np.linspace(1, 0, n_out)[:, None] ** 1.2
peak = np.max(np.abs(master))
master = master / peak * 0.92
pcm = (master * 32767).astype(np.int16)

with wave.open("/home/johnzealanddoyle/projects/cloudflare-git-comp/video/nextgit-promo/assets/bgm/track.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

import os
print("wrote track.wav", round(os.path.getsize("/home/johnzealanddoyle/projects/cloudflare-git-comp/video/nextgit-promo/assets/bgm/track.wav")/1024/1024, 1), "MB,", len(pcm)/SR, "s, peak", round(float(peak),3))
