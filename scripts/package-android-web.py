#!/usr/bin/env python3
"""Deterministic web content archive; keep the JNI library independent of web-only edits."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1] / 'apps/tether'
output = root / 'src-tauri/gen/android/app/src/main/assets/tether-web.zip'
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for path in sorted((root / 'build').rglob('*')):
        if path.is_file():
            info = ZipInfo(path.relative_to(root / 'build').as_posix(), (2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
print('Packaged Android web content')
