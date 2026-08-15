# VCHS-EPK — the extension package format

Status: **the JS reader and writer are built and green** —
`src/utils/epkFormat.js`, with the §8a conformance corpus in
`src/utils/epkCorpus.js` and 46 tests in `src/utils/epkFormat.test.js`. The
native Android unpacker and the Electron reader are not. Supersedes VCHS-ECS for
`.extbk` files.

Sections marked **[build finding]** changed because writing the implementation
proved the earlier text wrong; they are not revisions of opinion.

The file extension stays `.extbk` — one file type for the reader, one magic number
for the parser to tell the versions apart. `apiVersion: 2` extensions ship in
EPK; ECS files are refused, not adapted.

**Format ceiling: 4 GiB − 1 byte. Policy cap: 1 GB. Signed with Ed25519, and
self-repairing — see §6a.** The gap between the two size numbers is deliberate
and small. The format's ceiling is not a round number
someone picked; it is exactly what a 32-bit offset addresses, and — see §1a — it
is exactly what the least capable filesystem in circulation can hold. The policy
cap is where the validator sits, and it can move up to the ceiling without a
format change.

---

## 1. Why a new container at all

ECS is a good format for the thing it was designed for, and the wrong shape for
a gigabyte-scale extension. Three properties, each deliberate, each now in the way:

| ECS property | why it exists | why it blocks us |
|---|---|---|
| **Section index at the front** | one seek to know the whole file | every section's length must be known before a byte is written — you cannot stream a 700 MB asset into it |
| **Reed–Solomon over every section** | a manuscript must survive bit rot | 20% parity over 1 GB is **200 MB of parity** protecting a PNG that could just be re-downloaded |
| **Everything is a section** | uniform parsing | an asset cannot be read without walking the index and inflating around it |

And the practical wall, measured in the app as it stands: an install today is
whole-file base64 → whole-file `Uint8Array` → inflate. `MainActivity` already
sidesteps the bridge above **2 MB** of base64, with the comment *"don't shove
multi-MB base64 through evaluateJavascript"*. A 1 GB package is five hundred
times past a limit the app already works around.

So EPK keeps ECS's recovery instincts exactly where they earn their cost, and
takes the archive-format lessons everywhere else.

## 1a. Where the ceilings are, and why 4 GiB is the right one

Every size and offset field is **32-bit**. That puts the format's ceiling at
4,294,967,295 bytes — and the reason to accept that rather than route around it
is that a second, entirely independent limit lands on the same number:

| ceiling | value | who imposes it |
|---|---|---|
| Format | **4,294,967,295 B** | the 32-bit offset fields |
| Single file on FAT32 | **4,294,967,295 B** | the filesystem, on a great deal of removable storage |
| **Policy** | **1 GB** | us, in the manifest validator |
| Practical, on a phone | free space | checked before the first write |

**A package that a valid EPK header can describe is a package that fits on any
filesystem still in use.** That is worth more than an arbitrarily higher ceiling:
there is no size an author can legally build that the user then cannot copy to an
SD card. The earlier 64-bit design bought a terabyte of theoretical headroom and
paid for it with an entire class of "it built fine and won't copy" support
questions.

Two more things fall out of 32-bit fields, both of which make the reader smaller:

**No BigInt anywhere.** A 32-bit value fits a JavaScript `Number` exactly, so
every offset, size and length in the read path is ordinary arithmetic. A 64-bit
format forces `BigInt` or a manual hi/lo split through every seek and comparison,
and `BigInt` does not mix with `Number` without explicit conversion at each
boundary. That was pure tax.

**Free space is still checked before a byte is written**, against the *unpacked*
size in the directory rather than the package size. A package of `store`-coded
PNGs unpacks to roughly its own size; one of deflated JSON might triple. The
directory carries `originalSize` per entry precisely so this sum is known up
front.

---

## 2. What was taken from where

| from | taken | rejected |
|---|---|---|
| **zip / apk** | central directory **at the end**; per-entry independence; append-a-signature without rewriting; alignment for mmap; **local headers before each entry** | the 65,535-entry ceiling |
| **tar.gz** | pure streaming write | solid stream — reaching the last file means decompressing all of it |
| **7z** | per-entry codec choice | solid blocks — great ratio, hostile to random access |
| **VCHS-ECS** | three-point header arbitration; per-entry cryptographic integrity; RS parity on what cannot be re-fetched | RS over *everything*; index at the front; CRC32 as the only check |

Two entries in that row moved out of the rejected column, and both are worth
flagging because earlier drafts of this document rejected them:

**zip's 4 GB ceiling is now shared deliberately**, for the reason in §1a. What is
still rejected is zip's *entry* ceiling, which was structural — 65,535 baked into
a 16-bit field. Here the equivalent limit is a validator setting over a 32-bit
field, so raising it is a config change rather than a format break.

**zip's local headers are back**, as entry preambles (§3.2a). They were rejected
as pointless duplication; the auto-repair requirement makes that duplication the
whole point, since it is what lets a destroyed central directory be rebuilt by
scanning.

The one-line summary: **zip's shape, ECS's paranoia, applied only to the part
that cannot be re-downloaded.**

---

## 3. Layout

```
 offset 0
┌─────────────────────────────────────────────────────────────┐
│ FRONT HEADER                                    64 bytes    │
│   magic \x89EPK\r\n\x1a\n · version · flags · uuid          │
│   coreOff/coreLen · blobOff/blobLen · dirOff                │
├─────────────────────────────────────────────────────────────┤
│ CORE REGION                       RS-protected, small       │
│   MNFT  manifest.json                          (deflate)    │
│   CODE  every .js in the bundle, concatenated  (deflate)    │
│   RSPX  Reed–Solomon parity over the core                   │
├─────────────────────────────────────────────────────────────┤
│ BLOB REGION                       streamed                  │
│   preamble + entry 1 bytes                                  │
│   preamble + entry 2 bytes  each independently coded,       │
│   …                         4096-aligned when stored        │
│   preamble + entry N bytes  RSPX follows kind=code entries  │
├─────────────────────────────────────────────────────────────┤
│ CENTRAL DIRECTORY                 one record per entry      │
│   path · offset · sizes · sha256 · codec · flags            │
│ DIRECTORY PARITY                  Reed–Solomon over it      │
├─────────────────────────────────────────────────────────────┤
│ SIGNATURE BLOCK                   Ed25519, appendable       │
├─────────────────────────────────────────────────────────────┤
│ TAIL                                           128 bytes    │
│   magic \x89EPK_END\r\n · dirOff/dirLen/count/parityLen     │
│   · package hash · verbatim copy of the front header        │
└─────────────────────────────────────────────────────────────┘
```

All integers little-endian, as in ECS.

### 3.1 Front header — 64 bytes

| off | size | field | notes |
|---|---|---|---|
| 0 | 8 | magic | `89 45 50 4B 0D 0A 1A 0A` — `\x89EPK\r\n\x1a\n` |
| 8 | 2 | formatVersion | `1` for EPK v1 |
| 10 | 2 | flags | bit 0 signed · bit 1 core-RS present · bits 2–15 reserved |
| 12 | 16 | uuid | identifies this build; survives renaming |
| 28 | 4 | coreOffset | |
| 32 | 4 | coreLength | core is bounded — see §4 |
| 36 | 4 | blobOffset | |
| 40 | 4 | blobLength | |
| 44 | 4 | dirOffset | |
| 48 | 1 | **rsParity** | parity bytes per RS chunk, `0` for none — **[build finding]** |
| 49 | 15 | reserved | zero-filled; room for v2 without moving anything |

`dirLength` and the entry count live in the tail, because the directory is the
last thing written.

The `\x1a\n` in the magic is the PNG trick: `\x1a` is DOS end-of-file, so a
package `type`d on a terminal stops rather than spraying binary, and the `\r\n`
pair detects a transfer that mangled line endings.

### 3.2 Central directory record — 52 bytes + path

No CRC: a full cryptographic hash sits where zip put a checksum, so the same
field answers "is this corrupt" and "is this the file the signature covers".

| off | size | field |
|---|---|---|
| 0 | 4 | entryOffset — absolute, from file start |
| 4 | 4 | storedSize — bytes on disk |
| 8 | 4 | originalSize — after decoding |
| 12 | 32 | sha256 — over this entry's **original** bytes |
| 44 | 1 | codec — `0` store · `1` deflate-raw · `2–255` reserved |
| 45 | 1 | kind — `0` asset · `1` rasterised-from-SVG · `2` font · `3` widget resource · `4` code |
| 46 | 2 | flags — bit 0 host-renderable · bit 1 aligned · bit 2 lazy |
| 48 | 2 | pathLength |
| 50 | 2 | reserved |
| 52 | n | path — UTF-8, `/`-separated, no `.` or `..` segments |

Each record is padded to a 4-byte boundary so the next one starts aligned.

### 3.2a Entry preambles — the rejected zip feature, reinstated

§2 rejects zip's local-header duplication. **The auto-repair requirement in §6a
reverses that**, and it is worth saying why rather than quietly flipping it.

Every blob entry is preceded by an 8-byte sync marker `\x89EPKENT\n` and a
verbatim copy of its directory record. Duplication is exactly the point: it means
the central directory is **reconstructible by scanning the file** when the
directory and its parity are both gone. That is the difference between "this
package is dead" and "this package takes four seconds longer to open."

The cost is ~60 bytes plus the path per entry — for a hundred-file extension,
about 10 KB. It buys the deepest layer of the repair ladder.

**The directory always wins.** A preamble is consulted only when the directory is
unrecoverable. When the directory verifies against the signed package hash,
preambles are never read at all, so a package cannot smuggle different metadata
into them.

### 3.2b Integrity: one hash per entry, and why that is now enough **[build finding]**

> **The core's parity block is a fixed 8-byte trailer, not a section in the
> stream.** This one is a build finding worth stating loudly, because getting it
> wrong is subtle and fatal: if the parity is located by walking sections until
> an `RSPX` tag turns up, that walk trusts a length field the damage may have
> hit — and then the parity needed to repair the damage is exactly what cannot
> be found. The last eight bytes of the core are `RSPX` + parity length, always,
> and the parity sits immediately before them.

An earlier draft carried a per-entry Merkle tree — first hand-rolled as a chunk
table, then as BLAKE3, whose internal binary tree over 1 KiB chunks gives slice
verification for free. Both existed to answer one question: *how do you verify
part of an entry without reading all of it?*

At a terabyte that question is unavoidable. At 1 GB it answers itself: **you read
all of it, because all of it is one second of hashing.** SHA-256 with hardware
acceleration — ARMv8 crypto extensions on every phone that matters, SHA-NI on
desktop — runs at gigabytes per second. The largest legal entry hashes in about
the time the file dialog takes to close.

So the tree goes, and with it the reason to bundle a hash function:

| what the Merkle tree bought | at 1 GB |
|---|---|
| verify one region without the whole entry | the whole entry *is* the region |
| resumable transfer | a transport concern; HTTP range + verify on completion |
| repair the smallest possible unit | re-fetch the entry — it is at most 1 GB, usually kilobytes |
| parallel verification | one core finishes before the disk does |

What is kept is the part that was actually about paranoia: **every entry carries
a full 256-bit cryptographic hash, not a checksum.** CRC32 detects accidents;
SHA-256 detects an attacker. That distinction was the point of the change, and it
survives intact.

### 3.2c The primitive set

| job | choice | why |
|---|---|---|
| **Entry and package integrity** | **SHA-256** | Present natively in WebCrypto, in Node's `crypto`, and in Android's `MessageDigest`. Hardware-accelerated on both architectures. Nothing to bundle, nothing to audit, no new supply chain. |
| **Compression** | **deflate-raw** | `DecompressionStream('deflate-raw')` in the browser, `zlib` in Node, `java.util.zip` in Android. Same argument: it is already everywhere it needs to be. |
| **Core recovery** | **Reed–Solomon, unchanged** | Still the right tool for a small blob that must survive bit rot in place, already implemented in this repo, already tested. |
| **Blob recovery** | **re-fetch the entry** | Not parity. RS over the blob region would add 20% to every download to avoid re-fetching an asset that is re-downloadable by definition. |
| **Signing** | **Ed25519 over the package hash** | 64 bytes signs the package transitively. Fast to verify on a phone, and the hash is already computed. |

Everything hangs off one value: **the SHA-256 of the package**. What it covers
directly is the header, the core, the directory and the directory's parity —
**not the blob bytes**, which are covered *transitively* because the directory
holds a SHA-256 per entry and the directory is hashed.

That indirection was found while building the reader, and it buys two things the
direct version cannot:

- **Verifying a signature costs O(core + directory), not O(package).** A 1 GB
  extension verifies in milliseconds instead of by re-reading a gigabyte. At the
  policy cap that is the difference between a check and a wait.
- **It separates the two failure modes §8 already treats differently.** Bit rot
  in one PNG fails that entry's own digest and is dropped at rung 8; any edit to
  the *map* fails the package hash and is refused. An attacker who flips bytes
  in an asset can therefore **destroy it but never substitute it** — denial, not
  deception — because the digest naming it lives inside the signed directory.

### 3.2d What the smaller ceiling bought here

BLAKE3 and Zstandard are better primitives in isolation, and at a terabyte the
gap is decisive — a hand-rolled Merkle tree over SHA-256 in JavaScript is not a
thing that finishes. But both would have meant a bundled implementation on
**three** platforms: a native library for Android, a Node binding for desktop,
and WASM for the web build and the CLI. Three build integrations, three things to
keep patched, three things in the supply chain of a package format whose entire
job is to be trustworthy.

Dropping the ceiling to 4 GiB deletes the argument for paying that, because it
deletes the workload that justified it. This is the clearest single win of the
respec: **the format now needs nothing that is not already on every platform it
runs on.**

If the policy cap ever moves far past 1 GB, this is the decision to revisit
first — the codec byte and the reserved header space are laid out so that adding
Zstandard as codec `2` is a version bump, not a format break.

### 3.3 Tail — 128 bytes

| off | size | field |
|---|---|---|
| 0 | 10 | magic `\x89EPK_END\r\n` |
| 10 | 4 | dirOffset |
| 14 | 4 | dirLength |
| 18 | 4 | entryCount |
| 22 | 4 | dirParityLength |
| 26 | 6 | reserved |
| 32 | 32 | **package SHA-256** — over header ‖ core ‖ directory ‖ directory parity |
| 64 | 64 | **verbatim copy of the front header** |

The hash is the anchor: read it once, and every subsequent read verifies against
it. A directory that has been tampered with fails before a single offset in it is
trusted.

This is ECS's three-point arbitration, kept: a package whose first 64 bytes are
damaged is still fully parseable from the tail, and one whose tail is truncated
is parseable from the front as far as the blob region. The reader compares both
and reports which it used.

### 3.4 The directory is read whole

There is no sparse index. The previous design needed one because a million-entry
directory at terabyte scale was 70 MB and could not be held to look up one icon.
At the policy cap that case is gone: the validator caps entry count at **65,536**,
which is at most ~4.5 MB of directory — the same order as the core, and bounded
for the same reason.

So the reader loads the directory once, verifies it against the package hash, and
builds a path → record map. One seek, one read, then every lookup is O(1) instead
of a binary search plus a bounded scan.

The cap is a validator constant, not a field width — see §2. Cloud Backup ships
around ten files; the cap exists to bound memory against a hostile package, not
to constrain any real author.

---

## 4. The core / blob split

**The whole design is this line:** the core must be intact or there is no
extension; a blob entry can be lost and the extension still runs with a missing
image.

| | core | blob |
|---|---|---|
| Holds | manifest, all `.js` | images, fonts, rasters, widget resources, `.wasm` |
| Reed–Solomon | **yes**, 20% as now | **only `kind = code`** — see §4a |
| Held whole in memory | yes | **never** |
| Size ceiling | **4 MB**, enforced at build | **1 GB** policy cap |
| Corrupt ⇒ | repaired, or package refused | repaired if code, dropped if asset |

A 4 MB core ceiling is generous — Cloud Backup's entire JS is under 200 KB — and
it is what guarantees the memory story: **the only things ever fully resident are
bounded and small** — the core at 4 MB and the directory at 4.5 MB, whether the
package is 40 MB or 1 GB. That invariant is why the rest of the format can be as
large as it likes.

---

## 4a. What gets parity — the rule, and where WASM lands

The old rule was positional: the core gets Reed–Solomon, the blob does not. That
was a proxy for the property that actually matters, and the auto-repair
requirement makes the proxy leak. **The rule is now about replaceability:**

> Parity protects what is **bounded and irreplaceable**. Everything large and
> re-downloadable is repaired by re-fetching it.

| region | bounded? | irreplaceable? | parity |
|---|---|---|---|
| Core — manifest + JS | 4 MB | yes, no extension without it | **20%** |
| Central directory | 4.5 MB | yes, it is the map | **20%** |
| Blob entry, `kind = code` (`.wasm`) | per entry | yes, dead extension without it | **20%** |
| Blob entry, any other kind | up to 1 GB | no, re-downloadable | none |

**Two changes fall out, and both were previously impossible.**

**The directory gets parity.** Under the terabyte design a directory could be
70 MB and parity for it was not affordable. Capping entry count made it bounded —
same property as the core, so it gets the same treatment. Typical cost is a few
kilobytes, worst case 900 KB. This closes the format's last unrecoverable case:
directory damage was a flat refusal, and is now repaired in place.

**WASM goes in the blob, with parity.** The question was whether `.wasm` belongs
in the RS-protected core or the unprotected blob, and the honest answer was that
neither was right — the core would blow its 4 MB ceiling, which is the invariant
everything else rests on, and the blob offered no repair. Splitting parity from
region resolves it: a `kind = code` entry lives in the blob, so the core ceiling
holds, and carries its own `RSPX` block immediately after it, so a corrupt
`.wasm` is repaired rather than fatal. Cost is 20% of the WASM, not 20% of the
package.

Everything else keeps the original reasoning. RS exists in this codebase to keep
*manuscripts* alive through bit rot; an image that fails its hash is
re-obtainable, and 20% parity across the blob region would add 200 MB to a 1 GB
download to avoid re-fetching one PNG.

---

## 4b. Not everything has to land on disk

"Unpack the package" and "install the extension" are still not the same event. An
entry may be flagged **lazy** (directory flags bit 2): it stays in the package and
is extracted on first use, or streamed straight from its byte range without ever
being copied out.

This is what keeps a large extension installable on a device that could not hold
it twice — which at a 1 GB cap is an ordinary phone with a nearly full disk, not
an exotic case. The package occupies its size once; the unpacked working set is
whatever has actually been touched. `originalSize` is still summed at install for
the free-space check, but lazy entries count against a *reserve*, not a
requirement.

The manifest declares which paths are lazy, so the decision is the author's and
is visible in review, rather than a heuristic the installer guesses at.

---

## 5. Codec choice

Per entry, decided by the writer:

- **store** for anything already compressed — PNG, JPEG, WebP, woff2, mp4.
  Deflating a PNG costs CPU on both ends and typically gains under 1%.
- **deflate-raw** for text-shaped assets — JSON, SVG source, CSV, uncompressed
  audio.

Stored entries are padded to a **4096-byte boundary** so the platform can map
them without copying — the same reason `zipalign` exists. "Read this 200 MB image
by mapping it" and "read it by copying it into the heap" are not the same
operation on a phone.

---

## 6. Reading and writing

### 6.1 Writing (streaming, constant memory)

```
write placeholder header (64 B)
build core in memory  (bounded: ≤ 4 MB)  → RS-encode → write, note offset/len
for each asset:
    open source, pick codec, stream through encoder to output
    hash through SHA-256 as bytes pass
    keep the entry digest; sizes accumulate alongside
    write the preamble (sync marker + this entry's record)   §3.2a
    write the encoded bytes
    if kind = code: RS-encode the entry, append its RSPX      §4a
    push a directory record
    pad to 4096 if stored
    refuse if the running offset would exceed the format ceiling
write central directory, sorted by path
RS-encode the directory, append its parity                    §4a
finalise the package hash over everything written so far
write signature block if signing
write tail (dirOffset, dirLength, entryCount, dirParityLength,
            package hash, copy of header)
seek 0, rewrite the real header
```

The preamble is written *before* the entry's bytes, which means its record is
built from sizes not yet known — so the writer reserves it, streams the entry,
then seeks back and fills it. That is one extra seek per entry, and it is why
the preamble is a fixed-position copy rather than something appended after.

The directory is sorted by path for determinism — the same inputs produce the
same bytes, which is what makes a build reproducible and a signature checkable —
not because anything binary-searches it.

Peak memory: the core (≤ 4 MB), one streaming buffer, and the directory (≤ 4.5 MB).
Independent of package size.

### 6.2 Reading

```
read tail (last 128 B)           → dirOffset, dirLength, entryCount, package hash
read directory, verify against the package hash, build path → record map
read core, verify RS, inflate    → manifest + code   (this is all JS ever sees)
find one asset:
    map lookup                          (in memory)
    seek entryOffset, stream storedSize bytes through the decoder,
        verify the digest as the bytes pass
```

### 6.3 The part that decides whether any of this works

**The unpacker must be native on both platforms.** This is the real fix for a
gigabyte package, and it is not a format property — it is where the code runs.

A WebView cannot stream a file: Capacitor's `Filesystem.readFile` has no range
parameter, and the bridge is a base64 string. That is precisely why
`MainActivity` already routes large books around it. So:

| platform | who unpacks |
|---|---|
| Android | a native plugin method taking the `content://` URI, streaming to the extension directory |
| Desktop | the Electron main process, with node streams |
| Web / tests | the JS reader, with a low size ceiling — enough for development, never for 1 GB |

JS receives the manifest and the code. It never receives an asset's bytes as
base64; it receives a path on disk, and — inside the sandbox — a `blob:` URL the
host minted.

---

## 6a. Repair

**A reader that detects damage and stops has done half a job.** Every layer below
is attempted, in order, before anything is reported to the user; the user hears
about damage only when the ladder runs out. This is the same stance the app takes
with a partially-recoverable book.

### 6a.1 The ladder

| # | damage | how it is corrected | needs network |
|---|---|---|---|
| 1 | front header unreadable | verbatim copy in the tail | no |
| 2 | tail unreadable | front header carries the offsets; `entryCount` and `dirLength` re-derived by scanning | no |
| 3 | **file shorter than the tail says** | **not corruption — an unfinished download.** Reported as *incomplete*, with the byte to resume from | resume only |
| 4 | core damaged | Reed–Solomon, 20% | no |
| 5 | directory damaged | Reed–Solomon over the directory (§4a) | no |
| 6 | directory *and* its parity gone | rebuild by scanning entry preambles (§3.2a), then write the rebuilt directory and fresh parity back | no |
| 7 | `kind = code` entry damaged | that entry's own `RSPX` block | no |
| 8 | asset entry damaged | dropped; the extension is told it is missing, and it is re-fetched if a channel is configured | to repair |
| 9 | package hash still wrong after all of the above | **refused** — the ladder is out | — |

Layer 3 is the one that matters most in practice. Bit rot is rare; **a download
that stopped early is the common failure at gigabyte sizes**, and it is perfectly
recoverable. Treating a short file as corruption would throw away a mostly-good
package and restart a 1 GB transfer. The reader distinguishes them by checking
length against the tail *before* it checks any hash.

### 6a.2 Repair is written back

A correction that stays in memory lets the same damage recur, and bit rot
accumulates — repair it on every open and one day it exceeds RS tolerance and the
package dies anyway. So when the reader repairs a package it **rewrites the
corrected bytes in place**, if the file is writable, and logs what it fixed.

This is also what makes rungs 1, 5 and 6 verifiable rather than merely
plausible. A recovered header, a Reed-Solomon-corrected directory and a
directory rebuilt from preambles are all written back *before* the package hash
is recomputed — so the hash check in §6a.4 is testing the repaired package, and
a repair that was wrong fails it. Records serialise identically in every writer,
which is why a directory rebuilt from intact preambles is byte-for-byte the one
that was lost.

Repairs are idempotent and touch only the damaged range. A read-only package
(on a read-only mount, or a `content://` URI with no write grant) is repaired in
memory for that session and the inability to persist is recorded, not surfaced as
an error.

### 6a.3 Where the ladder stops, stated plainly

"Automatically correct any issue" is the goal, not a guarantee, and the places it
does not reach should be written down rather than discovered:

- **An asset entry with no parity and no update channel.** Nothing to reconstruct
  it from. It is dropped and the extension runs without it — degraded, not dead.
- **Damage past RS tolerance.** 20% parity corrects up to 10% of a region as
  unknown-position errors. Beyond that the region is gone.
- **Damage to *both* a region and its redundancy.** Two independent failures in
  the same place; layer 6 exists precisely to add a third copy for the directory,
  which is the region where this would hurt most.
- **Deliberate tampering.** This is not a repair case, it is layer 9 — see below.

### 6a.4 Repair and signing reinforce each other

Ed25519 (§7) turns out to be what makes automatic repair *trustworthy*, and this
was not the reason for adding it:

**The signature is the oracle that says the repair was right.** A correct repair
restores the original bytes, so the package hashes to the value the signature
covers, and it verifies again. A repair that guessed wrong does not. So the
reader never has to decide whether its own correction was plausible — it checks.

That gives the one rule that keeps repair from becoming an attack:

> **Repair may never turn a package the signature rejects into one it accepts.**
> The ladder runs, the package hash is recomputed, and the signature is verified
> against the result. If it does not verify, the package is refused — regardless
> of how much of it was successfully reconstructed.

Without that rule, an attacker corrupts a signed package on purpose and hopes the
repairer "corrects" it into something that runs. With it, repair can only ever
move a package back toward the bytes its author signed.

---

## 7. Signing

**Ed25519, and it ships in 1.1.20.** Earlier drafts deferred it; §7.2 is why that
was wrong.

The signature block sits between the directory and the tail, and covers the
package SHA-256 — so it authenticates the header, the core and the directory
directly, and every entry's content transitively through the per-entry digests
the directory carries (§3.2b). Because the directory is
already written by then, a package can be signed *after* it is built without
rewriting a byte — the zip property that makes APK signing possible.

### 7.1 Why it is now cheap

The primitive revert in §3.2d is what makes this nearly free. Ed25519 is native
in WebCrypto, in Node's `crypto`, and on Android — the same "already on every
platform" property that SHA-256 and deflate have. The whole feature is a 64-byte
block, a public key compiled in as a build constant, and one `verify` call
against a hash that is computed anyway.

| | |
|---|---|
| Signature | 64 bytes |
| Public key | 32 bytes, a build constant |
| Verification cost | one call, on a hash already computed for §6a |
| New dependencies | **none** on any platform |

### 7.2 The update channel is the reason this cannot wait

Deferring signing while shipping an update channel would have been the largest
hole in v2, and it is worth recording so it is not reopened.

Cloud Backup holds `library:read:all` and `network` — read every manuscript, and
an egress to send them to. An update re-prompts only for the **permission delta**,
so an update that keeps the same permission set prompts for nothing at all.
Without signatures, anyone who controls the update channel — its host, anyone who
can intercept it, or whoever registers the domain after it lapses — can push a
build that silently inherits those grants. The sandbox does not help: the code is
running with permissions the user genuinely gave.

So the rule is:

> **Code that arrives over a network is installed only if it verifies against a
> key compiled into the app.** Manual installation from a file may proceed
> unsigned, with the unsigned state shown, because the user chose that file.

That split keeps local development friction-free without leaving the automatic
path unauthenticated.

### 7.3 Interaction with repair

Covered in §6a.4: the signature is what makes automatic repair safe, because it
independently confirms a repair restored the author's bytes rather than something
merely well-formed.

---

## 6b. Two guards the preamble scan needs **[build finding]**

Rung 6 walks arbitrary attacker-shaped bytes looking for sync markers, which
makes it the one loop in the reader that must terminate for *structural*
reasons rather than because the input behaves.

**The cursor must never move backwards.** After reading a preamble the scan
skips past the body that preamble describes — but a record may claim any
`entryOffset` inside the blob, including one *behind* the preamble carrying it.
The cursor then rewinds to a point before that preamble, finds it again, and
spins. The scan is synchronous, so this is not a slow read: it hangs the thread,
and no timeout or abort signal can interrupt it. Clamp the skip to never
decrease.

**And a hard iteration budget on top.** The clamp makes termination provable
today, but this loop exists precisely to cope with input nobody anticipated, and
a wrong answer is recoverable where a hang is not. Exceeding the budget is a
named refusal, `scan-budget-exceeded`. This is not theoretical — it caught the
unclamped loop live during development, turning a dead worker into a clean
refusal.

**The RS geometry belongs in the header, not in a reader option.** Related
finding, same root cause of trusting the caller: deriving parity size from an
`rsPct` argument means a package built at a different percentage produces a
parity-length mismatch, which reads as *unrecoverable core* on a perfectly good
package. Byte 48 of the header carries it, so a reader is never told and never
wrong.

---

## 7a. One structural rule the reader must get right **[build finding]**

**The directory's records must consume `dirLength` exactly.**

This looks like a nicety and is load-bearing: it is what separates *this
directory is destroyed* from *this directory contains something hostile*, and
those need opposite handling — destroyed means rebuild from preambles, hostile
means refuse immediately.

Without the check, a zeroed directory parses as `entryCount` records with empty
paths and zero offsets. Structurally valid, semantically nothing. The reader
then refuses it as an attack instead of repairing it, and a recoverable package
is thrown away. With the check, the byte count does not add up, the reader falls
through to rung 6, and the package comes back.

Conversely a hostile directory — one record edited, everything else intact —
consumes exactly `dirLength`, parses cleanly, and hits the path and range checks
in §8 as it should. An attacker cannot use the rebuild path to launder a bad
record, because reaching it requires the directory to be the wrong *size*, and
the preamble scan then recovers the author's original records anyway.

---

## 8. Refusals

**Every refusal below is reached only after §6a has run and failed.** Refusal is
the bottom of the ladder, not the first response to a bad byte.

The reader refuses, with the reason named, when:

- neither header validates *and* the directory cannot be rebuilt from preambles
- `formatVersion` is unknown
- the core fails RS beyond correction
- the directory fails RS **and** the preamble scan
- the signature is present and does not verify — including after a repair
- the package arrived over the update channel and carries no signature (§7.2)
- any path is absolute, contains `..`, or is not valid UTF-8
- the core exceeds 4 MB, or the package exceeds the configured cap
- `entryCount` exceeds the configured entry cap
- two records claim the same path
- an entry's byte range falls outside the blob region, or overlaps another
- any offset plus its length exceeds the file's actual size **and** the file is
  not merely truncated — see below

The path, overlap and bounds checks are the ones that matter for a hostile
package: an overlapping range is how an archive gets a reader to hand out the
wrong bytes, and an offset past the end is how it gets one to read something
else's memory. **These are structural, not damage** — they are refused
immediately and never sent to the repair ladder, because "correcting" an
attacker's offsets is exactly what a repairer must not do.

Two things that are explicitly **not** refusals:

- **A truncated file is incomplete, not corrupt.** It is reported with a resume
  offset (§6a.1 layer 3). Refusing here would restart a gigabyte transfer over a
  failure that costs nothing to finish.
- **A single failed asset hash.** It is dropped, logged, and the extension is
  told the asset is missing — the same graceful-degradation stance the app takes
  with a partially-recoverable book.

---

## 8a. Conformance — the corpus comes before the readers

EPK gets **three independent implementations**: a native Android unpacker, the
Electron main process, and the JS reader. Three implementations of one format is
where formats break, and they break *silently* — one reader accepts what another
refuses, and it surfaces as a bug report months later from the one platform
nobody tested on.

So the fixture corpus is written **before** any reader, and all three are run
against it in CI with identical expected verdicts. Not "it parses" — the exact
same verdict, the same repair path taken, and the same reason string.

**Well-formed fixtures**, each with its expected package hash checked in:

- empty package (zero entries), one entry, 65,536 entries
- every codec: `store`, `deflate-raw`, and a mix in one package
- every `kind`, including a `kind = code` entry with its RS block
- a lazy-flagged entry; a 4096-aligned stored entry
- unicode paths, deeply nested paths, a path at the length limit
- signed and unsigned variants of the same package

**Damage fixtures**, each asserting the ladder rung it should be repaired at:

| fixture | expected |
|---|---|
| front header zeroed | repaired from tail (rung 1) |
| tail zeroed | repaired from header (rung 2) |
| file cut at 60% | **incomplete**, resume offset reported (rung 3) |
| core with 5% bit flips | repaired by RS (rung 4) |
| core with 30% bit flips | refused, beyond tolerance |
| directory bit-flipped | repaired by RS (rung 5) |
| directory *and* parity zeroed | rebuilt from preambles (rung 6) |
| `.wasm` entry bit-flipped | repaired by its own RSPX (rung 7) |
| one PNG bit-flipped | dropped, extension told it is missing (rung 8) |
| signed package, one byte changed | refused after repair attempt (§6a.4) |

**Hostile fixtures**, which must be refused *without* entering the repair ladder:

- path `../../etc/passwd`; absolute path; path with a NUL; invalid UTF-8 in a path
- two records claiming the same path
- two entries whose byte ranges overlap
- `entryOffset + storedSize` past EOF; `entryOffset` inside the core region
- `entryCount` of 2³²−1 with a 200-byte directory
- `dirOffset` pointing into the blob region
- a preamble that disagrees with a directory record that verifies (preamble must
  be ignored — §3.2a)
- an unsigned package presented as a channel update (§7.2)

`scripts/check-extbk-crossread.mjs` is the shape of the runner; this is the
larger version, and the damage fixtures are generated deterministically from the
well-formed ones by a seeded corruptor so they can be regenerated rather than
stored as binaries.

---

## 9. Migration

There is no converter, and that is deliberate. Under the standing rule there are
no users, and Cloud Backup is the only extension: `extbk build` emits EPK, the
app reads EPK, and an ECS file is refused with a message saying to rebuild.

`extbk inspect` should read both, so an old package can still be examined.

---

## 10. Open

1. **Should `uuid` be content-addressed** — a hash of the core — rather than
   random? It would make "is this the same build" answerable without unpacking.
2. **Is 65,536 the right entry cap?** It bounds directory memory at ~4.5 MB, and
   now also bounds directory *parity* (§4a). A package shipping a large tile set
   is the case that would push on it, and raising it is a validator constant away.
3. **Does a repair get surfaced to the user at all?** §6a repairs silently and
   logs. An argument exists for a one-line notice — a package that needed repair
   twice is a failing disk, and the user would want to know that about their
   device rather than about the extension.

**Settled, and recorded so they are not relitigated:**

- **Ceiling: 4 GiB − 1 format, 1 GB policy.** A terabyte capability with a
  gigabyte of testing is a reputation a format does not deserve, and 32-bit
  fields coincide exactly with FAT32's file limit (§1a).
- **Primitives: SHA-256 + deflate-raw + Ed25519.** All three already present on
  all three platforms; the smaller ceiling removes the workload that justified
  bundling BLAKE3 and Zstandard (§3.2d). Codec `2` is left free for Zstandard if
  the cap ever moves.
- **Signing ships in 1.1.20**, not later — an unsigned auto-update path hands the
  channel whatever permissions the user already granted (§7.2).
- **Parity follows replaceability, not region.** Core, directory and `kind = code`
  entries get 20%; large re-downloadable assets get none (§4a). This is what puts
  WASM in the blob without leaving it unrepairable.
- **Entry preambles are back**, reversing §2's rejection of zip's local headers.
  Duplication is the point: it is the third copy of the directory (§3.2a).
- **No shared compression dictionary for the blob region.** Fifty widget PNGs do
  share bytes, but a dictionary costs the per-entry independence the whole format
  is built on. Considered and declined.
