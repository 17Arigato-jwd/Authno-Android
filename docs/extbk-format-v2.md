# VCHS-EPK — the extension package format

Status: **proposal.** Nothing is built. Supersedes VCHS-ECS for `.extbk` files.

The file extension stays `.extbk` — one file type for the reader, one magic number
for the parser to tell the versions apart. `apiVersion: 2` extensions ship in
EPK; ECS files are refused, not adapted.

**Design target: 4 GB minimum, 1 TB maximum.** Every structural decision below
is made against the top of that range, not the bottom. Where the format has a
ceiling it is stated; where the *device* is the ceiling, that is stated too,
because at a terabyte the device usually is.

---

## 1. Why a new container at all

ECS is a good format for the thing it was designed for, and the wrong shape for
a multi-gigabyte extension. Three properties, each deliberate, each now in the way:

| ECS property | why it exists | why it blocks us |
|---|---|---|
| **Section index at the front** | one seek to know the whole file | every section's length must be known before a byte is written — you cannot stream a 40 GB asset into it |
| **Reed–Solomon over every section** | a manuscript must survive bit rot | 20% parity over 1 TB is **200 GB of parity** protecting a PNG that could just be re-downloaded |
| **Everything is a section** | uniform parsing | an asset cannot be read without walking the index and inflating around it |

And the practical wall, measured in the app as it stands: an install today is
whole-file base64 → whole-file `Uint8Array` → inflate. `MainActivity` already
sidesteps the bridge above **2 MB** of base64, with the comment *"don't shove
multi-MB base64 through evaluateJavascript"*. A 4 GB package is two thousand
times past a limit the app already works around; a 1 TB one is half a million.

So EPK keeps ECS's recovery instincts exactly where they earn their cost, and
takes the archive-format lessons everywhere else.

## 1a. Where the ceilings actually are

Nothing in the layout below is allowed to be the limit. Every size and offset
field is 64-bit, which puts the format's own ceiling at 2^64 bytes — sixteen
exabytes — and leaves the real constraints where they belong:

| ceiling | value | who imposes it |
|---|---|---|
| Format | 16 EB | the 64-bit fields; never the binding constraint |
| **Policy** | **1 TB** | us, in the manifest validator |
| Single file on FAT32 | **4 GB** | the filesystem — an SD card formatted FAT32 **cannot hold a 4 GB+ package at all** |
| Single file on exFAT / ext4 / f2fs / NTFS | ≥ 16 TB | fine |
| Practical, on a phone | free space | see below |

Two consequences worth building for rather than discovering:

**FAT32 is a hard wall at 4 GB, and it is the format on a lot of removable
storage.** A package at or above the design *minimum* cannot even be written to
one. The installer must therefore check the target filesystem before it starts,
and say so plainly — "this extension is 6 GB and this card cannot hold a file
that large" — rather than failing 4 GB into a copy.

**Free space is checked before a byte is written**, against the *unpacked* size
in the directory, not the package size. A 40 GB package of `store`-coded PNGs
unpacks to roughly 40 GB; one of `deflate`-coded JSON might triple. The
directory carries `originalSize` per entry precisely so this sum is known before
the first write.

---

## 2. What was taken from where

| from | taken | rejected |
|---|---|---|
| **zip / apk** | central directory **at the end**; per-entry independence; append-a-signature without rewriting; alignment for mmap | the 4 GB and 65535-entry ceilings; the `local header` duplication |
| **tar.gz** | pure streaming write | solid stream — reaching the last file means decompressing all of it |
| **7z** | per-entry codec choice | solid blocks — great ratio, hostile to random access |
| **VCHS-ECS** | three-point header arbitration; CRC32 per entry; RS parity | RS over *everything*; index at the front |

The one-line summary: **zip's shape, ECS's paranoia, applied only to the part
that cannot be re-downloaded.**

---

## 3. Layout

```
 offset 0
┌─────────────────────────────────────────────────────────────┐
│ FRONT HEADER                                    64 bytes    │
│   magic \x89EPK\r\n\x1a\n · version · flags · uuid          │
│   coreOff/coreLen · blobOff/blobLen · dirOff/dirLen         │
├─────────────────────────────────────────────────────────────┤
│ CORE REGION                       RS-protected, small       │
│   MNFT  manifest.json                          (zlib)       │
│   CODE  every .js in the bundle, concatenated  (zlib)       │
│   RSPX  Reed–Solomon parity over the core                   │
├─────────────────────────────────────────────────────────────┤
│ BLOB REGION                       streamed, no RS           │
│   entry 1 bytes                                             │
│   entry 2 bytes            each independently coded,        │
│   …                        4096-aligned when stored          │
│   entry N bytes                                             │
├─────────────────────────────────────────────────────────────┤
│ CENTRAL DIRECTORY                 one record per entry      │
│   path · offset · sizes · crc32 · codec · flags             │
├─────────────────────────────────────────────────────────────┤
│ SIGNATURE BLOCK                   optional, appendable      │
├─────────────────────────────────────────────────────────────┤
│ TAIL                                            64 bytes    │
│   magic \x89EPK_END\r\n · dirOff · dirCRC                   │
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
| 28 | 8 | coreOffset | |
| 36 | 4 | coreLength | core is bounded — see §4 |
| 40 | 8 | blobOffset | |
| 48 | 8 | blobLength | 64-bit: this is the 1 GB part |
| 56 | 8 | dirOffset | |

`dirLength` and the entry count live in the tail, because the directory is the
last thing written.

The `\x1a\n` in the magic is the PNG trick: `\x1a` is DOS end-of-file, so a
package `type`d on a terminal stops rather than spraying binary, and the `\r\n`
pair detects a transfer that mangled line endings.

### 3.2 Central directory record — 64 bytes + path

| off | size | field |
|---|---|---|
| 0 | 8 | entryOffset — absolute, from file start |
| 8 | 8 | storedSize — bytes on disk |
| 16 | 8 | originalSize — after decoding |
| 24 | 8 | chunkTableOffset — 0 when the entry is a single chunk |
| 32 | 4 | chunkCount |
| 36 | 4 | crc32c — over the **original** bytes, whole entry |
| 40 | 1 | codec — `0` store · `1` deflate-raw · `2–255` reserved |
| 41 | 1 | kind — `0` asset · `1` rasterised-from-SVG · `2` font · `3` widget resource · `4` code |
| 42 | 2 | flags — bit 0 host-renderable · bit 1 aligned · bit 2 lazy |
| 44 | 2 | pathLength |
| 46 | 18 | reserved |
| 64 | n | path — UTF-8, `/`-separated, no `.` or `..` segments |

### 3.2a Chunk tables — the change that scale forces

A single CRC32 over a 40 GB entry is close to useless, and this is the one
place where the earlier draft was actually wrong rather than merely
conservative. Three reasons, all of which bite above a few gigabytes:

- **Detection weakens.** CRC32's guarantees are stated for inputs far smaller
  than this; past its burst-length bounds it degrades to roughly a 1-in-4-billion
  residual, which is not the number you want on the thing carrying somebody's
  fonts across a flaky mobile download.
- **Verification is all-or-nothing.** To check one byte you must hash 40 GB.
  A reader that wants to serve a single image ends up reading the whole entry.
- **Repair is all-or-nothing.** One flipped bit condemns the entire entry, so a
  1 TB package fails on a re-download of 1 TB.

So any entry above **8 MB** carries a **chunk table**: a flat array of
`(crc32c, blake3_128)` pairs, one per 8 MB chunk, stored contiguously at
`chunkTableOffset`. At 1 TB that is 131,072 chunks — a 3 MB table, itself
CRC-covered.

What it buys, in order of how much it matters:

| | |
|---|---|
| **Verify on read** | reading one image verifies the chunks it touches, not the entry |
| **Resumable transfer** | a download that dies at 700 GB resumes at the chunk boundary |
| **Targeted repair** | one bad chunk means re-fetching 8 MB, not the entry |
| **Parallel verification** | chunks hash independently, across cores |

`crc32c` rather than plain CRC32 throughout: it is the same cost in software and
a single instruction on every ARMv8 and x86-64 chip this will ever run on, which
matters when the job is hashing a terabyte.

### 3.3 Tail — 128 bytes

Magic `\x89EPK_END\r\n`, then `dirOffset` (8), `dirLength` (8), `entryCount`
(8), `dirIndexOffset` (8), `dirCRC32C` (4) — then a **verbatim copy of the
64-byte front header**.

`entryCount` is 64-bit. It costs four bytes to not have zip's 65,535-entry
problem, and a package that ships a tile set can pass that in one directory.

This is ECS's three-point arbitration, kept: a package whose first 64 bytes are
damaged is still fully parseable from the tail, and one whose tail is truncated
is parseable from the front as far as the blob region. The reader compares both
and reports which it used.

### 3.4 The directory index — needed once the directory itself is large

At a terabyte the central directory stops being small. A million entries is
~70 MB of records, and "read the directory, then look up a path" would mean
holding 70 MB to fetch one icon.

So the directory is written **sorted by path**, and `dirIndexOffset` points at a
sparse index: every 64th record's path hash and byte offset. A lookup is a
binary search over the sparse index — a few KB — then one bounded scan of at
most 64 records. **Constant memory, two seeks, whatever the package weighs.**

Below 4,096 entries the index is omitted (`dirIndexOffset = 0`) and the reader
simply loads the directory, because at that size the machinery costs more than
it saves.

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
| Size ceiling | **4 MB**, enforced at build | **1 TB** policy cap |
| Corrupt ⇒ | package refused | that one asset is dropped, with a warning |

A 4 MB core ceiling is generous — Cloud Backup's entire JS is under 200 KB —
and it is what guarantees the memory story: **the only thing ever fully resident
is bounded and small** — 4 MB, whether the package is 40 MB or a terabyte. That
invariant is the reason the rest of the format can be as large as it likes.

Dropping RS from the blob region is not a lowering of standards. RS exists in
this codebase to keep manuscripts alive through bit rot. An asset that fails its
check is re-obtainable, and 20% parity over 1 TB would add **200 GB** to every
download to avoid re-fetching one 8 MB chunk. The chunk table in §3.2a gives the
blob region something better than parity anyway: not "repair it in place", but
"know exactly which 8 MB to fetch again".

---

## 4a. Not everything has to land on disk

At 40 GB and up, "unpack the package" and "install the extension" stop being the
same event. An entry may be flagged **lazy** (directory flags bit 2): it stays in
the package and is extracted on first use, or streamed straight from its byte
range without ever being copied out.

This is what keeps a large extension usable on a device that could not hold it
twice. The package occupies its size once; the unpacked working set is whatever
has actually been touched. `originalSize` in the directory is still summed at
install for the free-space check, but lazy entries are counted against a
*reserve*, not a requirement.

The manifest declares which paths are lazy, so the decision is the author's and
is visible in review, rather than a heuristic the installer guesses at.

---

## 5. Codec choice

Per entry, decided by the writer:

- **store** for anything already compressed — PNG, JPEG, WebP, woff2, mp4. Deflating
  a PNG costs CPU on both ends and typically gains under 1%.
- **deflate-raw** for text-shaped assets — JSON, SVG source, CSV, uncompressed audio.

Stored entries are padded to a **4096-byte boundary** so the platform can map
them without copying — the same reason `zipalign` exists. At 1 GB scale, "read
this 200 MB image by mapping it" and "read it by copying it into the heap" are
not the same operation.

---

## 6. Reading and writing

### 6.1 Writing (streaming, constant memory)

```
write placeholder header (64 B)
build core in memory  (bounded: ≤ 4 MB)  → RS-encode → write, note offset/len
for each asset:
    open source, pick codec, stream through encoder to output
    hash each 8 MB chunk as it passes; append to the chunk table
    accumulate the whole-entry crc32c and sizes
    push a directory record (sorted insert, or sort at the end)
    pad to 4096 if stored
write chunk tables
write central directory, sorted by path; then the sparse index
note offsets, length, entryCount, crc32c
write signature block if signing
write tail (dirOffset, dirCRC, copy of header)
seek 0, rewrite the real header
```

Peak memory: the core (≤ 4 MB), one streaming buffer, and the growing directory.
Independent of package size — and if the directory itself grows past comfort it
is spilled to a temp file and merged, since it is written last.

### 6.2 Reading

```
read tail (last 128 B)           → dirOffset, entryCount, dirIndexOffset
read core, verify RS, inflate    → manifest + code   (this is all JS ever sees)
find one asset:
    binary-search the sparse index      (a few KB)
    scan ≤ 64 directory records         (a few KB)
    seek entryOffset, read only the chunks needed, verify each as it lands
```

### 6.3 The part that decides whether any of this works

**The unpacker must be native on both platforms.** This is the real fix for
1 GB, and it is not a format property — it is where the code runs.

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
- the directory CRC fails — the map itself cannot be trusted
- the core fails RS beyond correction
- any path is absolute, contains `..`, or is not valid UTF-8
- the core exceeds 4 MB, or the package exceeds the configured cap
- two records claim the same path
- an entry's byte range falls outside the blob region, or overlaps another

The last three are the ones that matter for a hostile package: an overlapping
range is how an archive gets a reader to hand out the wrong bytes.

A **single failed asset CRC is not a refusal.** It is dropped, logged, and the
extension is told the asset is missing — the same graceful-degradation stance
the app already takes with a partially-recoverable book.

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
   `kind = code`, chunk-hashed but not RS-protected, so a corrupt `.wasm` is a
   re-fetch of 8 MB rather than a dead package. **I lean to the blob.**
2. **Is 8 MB the right chunk?** Smaller means finer repair and a bigger table
   (4 MB chunks at 1 TB is a 6 MB table); larger means the opposite. 8 MB puts a
   1 TB package at 131,072 chunks and a 3 MB table, which fits the constant-memory
   rule comfortably.
3. **Does the policy cap sit at 1 TB, or lower for 1.1.20?** The format does not
   care. But the native unpackers, the resumable-download path and the free-space
   UX are all real work, and shipping a 1 TB *capability* with a 40 GB *tested*
   range is how a format acquires a reputation it does not deserve.
4. **Should `uuid` be content-addressed** — a hash of the core — rather than
   random? It would make "is this the same build" answerable without unpacking,
   which matters more when unpacking costs a terabyte of I/O.
5. **Shared compression dictionary for the blob region?** Fifty widget PNGs share
   a lot of bytes and a zstd dictionary would shrink them — at the cost of the
   per-entry independence the whole format is built on. Recorded as considered
   and declined.
