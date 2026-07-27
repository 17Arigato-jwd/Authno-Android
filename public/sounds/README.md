# Interface sounds

**Delivered and installed.** Each cue ships as `<stem>.ogg` with an `<stem>.mp3`
fallback, mono 44.1 kHz, peak-normalised with headroom to spare.
`src/utils/sounds.js` probes once and stays silent forever if a file is absent —
**a missing sound is never an error**.

| Stem | Length | Peak |
| --- | --- | --- |
| `gate_unlock` | 2.95 s | −2.9 dBFS |
| `key_invalid` | 0.42 s | −2.0 dBFS |
| `key_type` | 0.048 s | −4.8 dBFS |
| `trial_warn` | 1.72 s | −1.1 dBFS |
| `purchase_success` | 2.10 s | −2.6 dBFS |

Two more commissioned cues live in the **website** repo, because the actions
they mark happen there: `seal_break` (an invite is redeemed) and `invite_mint`
(one of your five is minted).

## What was done to the masters

The originals were 48 kHz stereo WAV. Processing: trailing silence trimmed,
downmixed to mono, resampled to 44.1 kHz, peak-normalised, encoded to Vorbis
q4 + MP3 96 k. `gate_unlock` and `purchase_success` arrived touching 0 dBFS and
were given 6 dB of headroom, because Vorbis overshoots on decode and would
otherwise clip.

`key_type` needed more than trimming: the master was **six separate taps in
sequence** (a recording of someone typing), not one keystroke. The single
cleanest tap — the one at 360 ms, ~50 dB above the noise floor — was extracted
to a 48 ms one-shot with 3 ms/15 ms fades so it cannot click when retriggered.

`seal_break` was muffled as requested: low-pass at 2.2 kHz plus a −6 dB shelf
above 3 kHz.

## The original brief

Soft foley, not chiptune. AuthNo's whole visual language is ink, paper, wax and
brass; a synthesised arcade blip would fight it. Record on a phone in a quiet
room, commission, or pull CC0 material from freesound.org and edit it down.

Deliver mono, 44.1 kHz WAV or OGG. Levels don't need mastering — `sounds.js`
carries per-sound volumes tuned by ear.

| Stem | Length | Character | Fires when |
| --- | --- | --- | --- |
| `gate_unlock` | ~1.2 s | Key turning in a lock, then a soft warm chord settling under it | The access key verifies — the one moment of ceremony in the whole app |
| `key_invalid` | ~0.4 s | Dull thud or a dry rubber stamp. Not a harsh buzz — nobody mistypes on purpose | A wrong key or pen name at the gate |
| `seal_break` | ~0.8 s | Wax seal cracking, small and crisp | Website: an invite code is redeemed (not used by the app) |
| `invite_mint` | ~0.7 s | Pen nib scratch with a sheet of paper sliding under it | Minting one of your five invites |
| `key_type` | ~80 ms | Faint nib tick. Must be almost subliminal — it can fire dozens of times | Optional per-keystroke cue at the gate; off by default |
| `trial_warn` | ~0.6 s | Two soft notes, falling. Gentle, not alarming | The trial is a day or two from ending |
| `purchase_success` | ~1.2 s | Warmer, rounder sibling of `gate_unlock` | A purchase completes |

## Rules the code already enforces

- Every sound respects the global "Interface sounds" switch
  (`setSoundsEnabled`), the same way haptics.js works.
- Sounds restart rather than overlap — these are cues, not a soundscape.
- Nothing in the app waits on, or branches on, audio playing.
