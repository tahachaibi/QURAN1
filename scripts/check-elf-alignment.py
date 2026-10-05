#!/usr/bin/env python3
"""
Fail if any 64-bit native library in an APK is not 16 KB page aligned.

Play refuses updates for apps targeting Android 15+ whose arm64-v8a / x86_64
libraries have a LOAD segment aligned below 16 KB, and it says so only at
upload. This reads the ELF program headers straight out of the APK, so it needs
nothing but Python: no NDK, no readelf of the right architecture.

  python3 scripts/check-elf-alignment.py app-release.apk
"""
import struct
import sys
import zipfile

PAGE = 16 * 1024
PT_LOAD = 1


def load_alignments(data: bytes):
    """The p_align of every LOAD segment of a 64-bit little-endian ELF."""
    if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
        return None
    e_phoff = struct.unpack_from("<Q", data, 0x20)[0]
    e_phentsize, e_phnum = struct.unpack_from("<HH", data, 0x36)
    out = []
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        p_type = struct.unpack_from("<I", data, off)[0]
        if p_type == PT_LOAD:
            out.append(struct.unpack_from("<Q", data, off + 0x30)[0])
    return out


def main(apk: str) -> int:
    bad, checked = [], 0
    with zipfile.ZipFile(apk) as z:
        for name in z.namelist():
            if not name.endswith(".so"):
                continue
            if not (name.startswith("lib/arm64-v8a/") or name.startswith("lib/x86_64/")):
                continue
            aligns = load_alignments(z.read(name))
            if aligns is None:
                continue
            checked += 1
            low = min(aligns) if aligns else 0
            if low < PAGE:
                bad.append(f"{name}: LOAD aligned to {low} bytes")
    if checked == 0:
        print("::error::no 64-bit native libraries found; the check did not run")
        return 1
    if bad:
        for line in bad:
            print(f"::error::{line}, below the 16 KB Play requires")
        return 1
    print(f"16 KB alignment: all {checked} 64-bit libraries pass")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
