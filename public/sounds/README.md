# Interface sounds

Drop the finished audio in this folder as `<stem>.ogg` (with an optional
`<stem>.mp3` fallback). `src/utils/sounds.js` probes once and stays silent
forever if a file is absent — **a missing sound is never an error**, so the app
ships and runs fine before any of these exist.

## The brief

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
