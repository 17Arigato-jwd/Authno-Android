# VCHS-EPK — the extension package format

Status: **proposal.** Nothing is built. Supersedes VCHS-ECS for `.extbk` files.

The file extension stays `.extbk` — one file type for the reader, one magic number
for the parser to tell the versions apart. `apiVersion: 2` extensions ship in
EPK; ECS files are refused, not adapted.

---

## 1. Why a new container at all

ECS is a good format for the thing it was designed for, and the wrong shape for
a 1 GB extension. Three properties, each deliberate, each now in the way:

| ECS property | why it exists | why it blocks us |
|---|---|---|
| **Section index at the front** | one seek to know the whole file | every section's length must be known before a byte is written — you cannot stream a 1 GB asset into it |
| **Reed–Solomon over every section** | a manuscript must survive bit rot | 20% parity over 1 GB is 200 MB of parity protecting a PNG that could just be re-downloaded |
| **Everything is a section** | uniform parsing | an asset cannot be read without walking the index and inflating around it |

And the practical wall, measured in the app as it stands: an install today is
whole-file base64 → whole-file `Uint8Array` → inflate. `MainActivity` already
sidesteps the bridge above **2 MB** of base64, with the comment *"don't shove
multi-MB base64 through evaluateJavascript"*. A 1 GB package is five hundred
times past a limit the app already works around.

So EPK keeps ECS's recovery instincts exactly where they earn their cost, and
takes the archive-format lessons everywhere else.

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

### 3.2 Central directory record — 48 bytes + path

| off | size | field |
|---|---|---|
| 0 | 8 | entryOffset — absolute, from file start |
| 8 | 8 | storedSize — bytes on disk |
| 16 | 8 | originalSize — after decoding |
| 24 | 4 | crc32 — over the **original** bytes |
| 28 | 1 | codec — `0` store · `1` deflate-raw · `2–255` reserved |
| 29 | 1 | kind — `0` asset · `1` rasterised-from-SVG · `2` font · `3` widget resource |
| 30 | 2 | flags — bit 0 host-renderable · bit 1 aligned |
| 32 | 2 | pathLength |
| 34 | 14 | reserved |
| 48 | n | path — UTF-8, `/`-separated, no `.` or `..` segments |

### 3.3 Tail — 64 bytes

Magic `\x89EPK_END\r\n`, then `dirOffset`, `dirLength`, `entryCount`,
`dirCRC32`, then a **verbatim copy of the front header**.

This is ECS's three-point arbitration, kept: a package whose first 64 bytes are
damaged is still fully parseable from the tail, and a package whose tail is
truncated is parseable from the front as far as the blob region. The reader
compares both and reports which one it used.

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
| Size ceiling | **4 MB**, enforced at build | 1 GB policy cap |
| Corrupt ⇒ | package refused | that one asset is dropped, with a warning |

A 4 MB core ceiling is generous — Cloud Backup's entire JS is under 200 KB —
and it is what guarantees the memory story: **the only thing ever fully resident
is bounded and small**, whatever the package weighs.

Dropping RS from the blob region is not a lowering of standards. RS exists in
this codebase to keep manuscripts alive through bit rot. An asset that fails its
CRC is re-obtainable by reinstalling, and 20% parity over 1 GB would add 200 MB
to every download to avoid a reinstall.

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
    accumulate crc32 and sizes as bytes pass
    push a directory record
    pad to 4096 if stored
write central directory, note offset/len/crc
write signature block if signing
write tail (dirOffset, dirCRC, copy of header)
seek 0, rewrite the real header
```

Peak memory: the core plus one streaming buffer. Independent of package size.

### 6.2 Reading

```
read tail (last 64 B)            → dirOffset, entryCount, dirCRC
read central directory            → the map, without touching a single asset
read core, verify RS, inflate     → manifest + code   (this is all JS ever sees)
per asset, on demand:
    seek entryOffset, read storedSize, decode, verify crc32
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

1. **Is 4 MB the right core ceiling?** It is the number that bounds memory. Cloud
   Backup is ~200 KB, so it is 20× headroom — but a WASM-heavy extension could
   want more, and WASM belongs in the core (it is code, and RS-worthy).
   Alternative: WASM is a blob entry with `kind = code`, CRC-checked but not
   RS-protected.
2. **Does the blob region need its own compression dictionary?** Fifty widget
   template PNGs share a lot of bytes. A shared zstd dictionary would shrink
   them meaningfully — at the cost of the per-entry independence this whole
   format is built on. Probably no; worth recording that it was considered.
3. **Should `uuid` be content-addressed** (a hash of the core) rather than
   random? It would make "is this the same build" answerable without unpacking.
