# VCHS-EPK — the extension package format

Status: **proposal.** Nothing is built. Supersedes VCHS-ECS for `.extbk` files.

The file extension stays `.extbk` — one file type for the reader, one magic number
for the parser to tell the versions apart. `apiVersion: 2` extensions ship in
EPK; ECS files are refused, not adapted.

**Format ceiling: 4 GiB − 1 byte. Policy cap: 1 GB.** The gap between those two
numbers is deliberate and small. The format's ceiling is not a round number
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
| **zip / apk** | central directory **at the end**; per-entry independence; append-a-signature without rewriting; alignment for mmap | the 65,535-entry ceiling; the `local header` duplication |
| **tar.gz** | pure streaming write | solid stream — reaching the last file means decompressing all of it |
| **7z** | per-entry codec choice | solid blocks — great ratio, hostile to random access |
| **VCHS-ECS** | three-point header arbitration; per-entry cryptographic integrity; RS parity on what cannot be re-fetched | RS over *everything*; index at the front; CRC32 as the only check |

Note what is no longer in the rejected column: **zip's 4 GB ceiling is now shared
deliberately**, for the reason in §1a. What is still rejected is zip's *entry*
ceiling, which was structural — 65,535 baked into a 16-bit field. Here the
equivalent limit is a validator setting over a 32-bit field, so raising it is a
config change rather than a format break.

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
│ BLOB REGION                       streamed, no RS           │
│   entry 1 bytes                                             │
│   entry 2 bytes            each independently coded,        │
│   …                        4096-aligned when stored         │
│   entry N bytes                                             │
├─────────────────────────────────────────────────────────────┤
│ CENTRAL DIRECTORY                 one record per entry      │
│   path · offset · sizes · sha256 · codec · flags            │
├─────────────────────────────────────────────────────────────┤
│ SIGNATURE BLOCK                   optional, appendable      │
├─────────────────────────────────────────────────────────────┤
│ TAIL                                            96 bytes    │
│   magic \x89EPK_END\r\n · dirOff/dirLen/count · pkg hash    │
│   + a verbatim copy of the front header                     │
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
| 48 | 16 | reserved | zero-filled; room for v2 without moving anything |

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

### 3.2a Integrity: one hash per entry, and why that is now enough

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

### 3.2b The primitive set

| job | choice | why |
|---|---|---|
| **Entry and package integrity** | **SHA-256** | Present natively in WebCrypto, in Node's `crypto`, and in Android's `MessageDigest`. Hardware-accelerated on both architectures. Nothing to bundle, nothing to audit, no new supply chain. |
| **Compression** | **deflate-raw** | `DecompressionStream('deflate-raw')` in the browser, `zlib` in Node, `java.util.zip` in Android. Same argument: it is already everywhere it needs to be. |
| **Core recovery** | **Reed–Solomon, unchanged** | Still the right tool for a small blob that must survive bit rot in place, already implemented in this repo, already tested. |
| **Blob recovery** | **re-fetch the entry** | Not parity. RS over the blob region would add 20% to every download to avoid re-fetching an asset that is re-downloadable by definition. |
| **Signing** | **Ed25519 over the package hash** | 64 bytes signs the package transitively. Fast to verify on a phone, and the hash is already computed. |

Everything hangs off one value: **the SHA-256 of the package** covers the core,
every blob entry and the directory. The tail carries it, the signature signs it,
and the directory cannot be trusted until it verifies against it.

### 3.2c What the smaller ceiling bought here

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

### 3.3 Tail — 96 bytes

Magic `\x89EPK_END\r\n`, then `dirOffset` (4), `dirLength` (4), `entryCount` (4),
four bytes reserved, and the **package SHA-256** (32) — then a **verbatim copy of
the 64-byte front header**.

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
| Holds | manifest, all `.js` | images, fonts, rasters, widget resources |
| Reed–Solomon | **yes**, 20% as now | **no** |
| Held whole in memory | yes | **never** |
| Size ceiling | **4 MB**, enforced at build | **1 GB** policy cap |
| Corrupt ⇒ | package refused | that one asset is dropped, with a warning |

A 4 MB core ceiling is generous — Cloud Backup's entire JS is under 200 KB — and
it is what guarantees the memory story: **the only things ever fully resident are
bounded and small** — the core at 4 MB and the directory at 4.5 MB, whether the
package is 40 MB or 1 GB. That invariant is why the rest of the format can be as
large as it likes.

Dropping RS from the blob region is not a lowering of standards. RS exists in
this codebase to keep manuscripts alive through bit rot. An asset that fails its
check is re-obtainable, and 20% parity would add 200 MB to a 1 GB download to
avoid re-fetching one image.

---

## 4a. Not everything has to land on disk

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
    push a directory record
    pad to 4096 if stored
    refuse if the running offset would exceed the format ceiling
write central directory, sorted by path
finalise the package hash over everything written so far
write signature block if signing
write tail (dirOffset, dirLength, entryCount, package hash, copy of header)
seek 0, rewrite the real header
```

The directory is sorted by path for determinism — the same inputs produce the
same bytes, which is what makes a build reproducible and a signature checkable —
not because anything binary-searches it.

Peak memory: the core (≤ 4 MB), one streaming buffer, and the directory (≤ 4.5 MB).
Independent of package size.

### 6.2 Reading

```
read tail (last 96 B)            → dirOffset, dirLength, entryCount, package hash
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

## 7. Signing

The signature block sits between the directory and the tail, and covers
**everything before it**. Because the directory is already written by then, a
package can be signed *after* it is built without rewriting a byte — the zip
property that makes APK signing possible.

Not built for 1.1.20. The block is reserved, the flag bit is allocated, and the
tail's offsets already account for it, so adding it later is not a format break.

---

## 8. Refusals

The reader refuses, with the reason named, when:

- neither header validates
- `formatVersion` is unknown
- the directory does not verify against the package hash — the map cannot be trusted
- the core fails RS beyond correction
- any path is absolute, contains `..`, or is not valid UTF-8
- the core exceeds 4 MB, or the package exceeds the configured cap
- `entryCount` exceeds the configured entry cap
- two records claim the same path
- an entry's byte range falls outside the blob region, or overlaps another
- any offset plus its length exceeds the file's actual size

The last four are the ones that matter for a hostile package: an overlapping
range is how an archive gets a reader to hand out the wrong bytes, and an offset
that runs past the end is how it gets one to read something else's memory.

A **single failed asset hash is not a refusal.** It is dropped, logged, and the
extension is told the asset is missing — the same graceful-degradation stance the
app already takes with a partially-recoverable book.

---

## 9. Migration

There is no converter, and that is deliberate. Under the standing rule there are
no users, and Cloud Backup is the only extension: `extbk build` emits EPK, the
app reads EPK, and an ECS file is refused with a message saying to rebuild.

`extbk inspect` should read both, so an old package can still be examined.

---

## 10. Open

1. **Where does WASM live?** It is code, so instinct says the RS-protected core —
   but a WASM-heavy extension blows a 4 MB core immediately, and the core ceiling
   is the invariant everything else rests on. Alternative: a blob entry with
   `kind = code`, hashed but not RS-protected, so a corrupt `.wasm` is a re-fetch
   rather than a dead package. **I lean to the blob.**
2. **Should `uuid` be content-addressed** — a hash of the core — rather than
   random? It would make "is this the same build" answerable without unpacking.
3. **Is 65,536 the right entry cap?** It bounds directory memory at ~4.5 MB. A
   package shipping a large tile set is the case that would push on it, and
   raising it is a validator constant away.

**Settled, and recorded so they are not relitigated:**

- **Ceiling: 4 GiB − 1 format, 1 GB policy.** A terabyte capability with a
  gigabyte of testing is a reputation a format does not deserve, and 32-bit
  fields coincide exactly with FAT32's file limit (§1a).
- **Primitives: SHA-256 + deflate-raw.** Both already present on all three
  platforms; the smaller ceiling removes the workload that justified bundling
  BLAKE3 and Zstandard (§3.2c). Codec `2` is left free for Zstandard if the cap
  ever moves.
- **No shared compression dictionary for the blob region.** Fifty widget PNGs do
  share bytes, but a dictionary costs the per-entry independence the whole format
  is built on. Considered and declined.
