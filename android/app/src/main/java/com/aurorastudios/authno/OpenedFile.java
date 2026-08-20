package com.aurorastudios.authno;

/**
 * OpenedFile — deciding what a file handed to us from outside actually is.
 *
 * A tapped .extbk in a file manager did nothing. The reason is that the three
 * intent handlers each asked the same question — "does this URI end in
 * .extbk?" — and a content URI almost never does. What Downloads hands over
 * is `content://com.android.providers.downloads.documents/document/msf%3A42`,
 * and the type it reports alongside it is application/octet-stream, because
 * Android has no mapping for our extensions. Every test failed, every handler
 * returned early, and the app opened on the home screen as if nothing had
 * been tapped.
 *
 * The name is not in the URI. It is in the provider, under
 * OpenableColumns.DISPLAY_NAME, and that is what the caller queries and hands
 * in here. Failing that, the bytes say it themselves: both of our containers
 * start with a magic number.
 *
 * Deliberately free of Android imports so the decision can be compiled and
 * exercised on its own — see scripts/check-opened-file.mjs. It is a pure
 * function of three strings and a handful of bytes, and it was the part that
 * was wrong.
 */
final class OpenedFile {

    static final String AUTHBOOK = "authbook";
    static final String EXTBK    = "extbk";
    static final String THMBK    = "thmbk";
    static final String UNKNOWN  = "unknown";

    /** \x89EXTBK\r\n — the v1 container, shared by .extbk and .thmbk. */
    private static final byte[] ECS_MAGIC =
        { (byte) 0x89, 0x45, 0x58, 0x54, 0x42, 0x4B, 0x0D, 0x0A };

    /** \x89EPK\r\n\x1a\n — the v2 extension package. */
    private static final byte[] EPK_MAGIC =
        { (byte) 0x89, 0x45, 0x50, 0x4B, 0x0D, 0x0A, 0x1A, 0x0A };

    private OpenedFile() { }

    /** How many leading bytes kindOf() can make use of. */
    static final int SNIFF_BYTES = 8;

    /**
     * @param name the provider's display name, or any filename we could find.
     *             Null when the provider offered none.
     * @param mime the intent's type. Null is common and not a problem.
     * @param head the first bytes of the file — SNIFF_BYTES is enough. May be
     *             null or short; that only costs the last of the three tests.
     * @return one of AUTHBOOK / EXTBK / THMBK, or UNKNOWN.
     */
    static String kindOf(String name, String mime, byte[] head) {
        // 1. The name, if we have one. This is the answer in practice: every
        //    provider worth the word supplies DISPLAY_NAME, and a person who
        //    named a file .extbk meant it.
        String n = name == null ? "" : name.toLowerCase();
        if (n.endsWith(".extbk"))    return EXTBK;
        if (n.endsWith(".thmbk"))    return THMBK;
        if (n.endsWith(".authbook")) return AUTHBOOK;

        // 2. A type only we would ever have registered. Rare — it needs the
        //    sending app to know our types — but unambiguous when present.
        String m = mime == null ? "" : mime.toLowerCase();
        if (m.equals("application/x-extbk"))    return EXTBK;
        if (m.equals("application/x-thmbk"))    return THMBK;
        if (m.equals("application/x-authbook")) return AUTHBOOK;

        // 3. The bytes. Both packages open with a magic number, which is what
        //    makes accepting application/octet-stream from the chooser safe:
        //    anything that is not ours is recognised as not ours here, before
        //    a single byte of it reaches the WebView.
        //
        //    The two package types share the v1 container, so this cannot
        //    tell an extension from a theme. It answers EXTBK, and the
        //    installer refuses a theme manifest by name rather than silently:
        //    a file that got this far had no name and no type, which is the
        //    one case where a clear error beats a guess either way.
        if (looksLike(head, ECS_MAGIC) || looksLike(head, EPK_MAGIC)) return EXTBK;

        return UNKNOWN;
    }

    private static boolean looksLike(byte[] head, byte[] magic) {
        if (head == null || head.length < magic.length) return false;
        for (int i = 0; i < magic.length; i++) {
            if (head[i] != magic[i]) return false;
        }
        return true;
    }
}
