#!/usr/bin/env python3
"""Check runtime source for trusted client-certificate headers and hard-coded secrets.

Environment-variable reads are allowed: deployment configuration should be
provided by the runtime, not embedded in source. This check intentionally
scans runtime source only and excludes tests, fixtures, generated output, and
documentation to avoid treating test data or policy text as executable code.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOTS = ("apps", "services", "packages", "backend")
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".sh"}
EXCLUDED_DIRS = {".git", "node_modules", "dist", "build", "coverage", ".next", "vendor", "__pycache__", "tests", "test", "__tests__", "fixtures"}
TEST_NAME = re.compile(r"(?:^|[._-])(?:test|spec)(?:[._-]|$)", re.IGNORECASE)
TRUSTED_CLIENT_CERT = re.compile(r"\bx-client-cert\b", re.IGNORECASE)
HARDCODED_SECRET = re.compile(
    r"""\b(?:JWT_SECRET(?:_CURRENT)?|API_KEY|ACCESS_TOKEN|PRIVATE_KEY|SECRET_KEY|CLIENT_SECRET|PASSWORD)\b\s*(?:=|:)\s*(['"])([^'"\r\n]{16,})\1""",
    re.IGNORECASE,
)
PLACEHOLDER = re.compile(
    r"(?i)^(?:replace[_ -]?me|your[_ -].*|example.*|dummy.*|test.*|change[_ -]?me.*|not[_ -]a[_ -]secret)$"
)


def is_runtime_source(path: Path) -> bool:
    if path.suffix.lower() not in SOURCE_SUFFIXES:
        return False
    if any(part.lower() in EXCLUDED_DIRS for part in path.parts):
        return False
    if TEST_NAME.search(path.name):
        return False
    return True


def inspect_text(text: str) -> list[tuple[int, str]]:
    findings: list[tuple[int, str]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if TRUSTED_CLIENT_CERT.search(line):
            findings.append((line_number, "untrusted-client-cert-header"))
        match = HARDCODED_SECRET.search(line)
        if match and not PLACEHOLDER.fullmatch(match.group(2).strip()):
            findings.append((line_number, "hard-coded-credential"))
    return findings


def scan(root: Path = ROOT) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    for source_root in SOURCE_ROOTS:
        directory = root / source_root
        if not directory.is_dir():
            continue
        for path in directory.rglob("*"):
            if not path.is_file() or not is_runtime_source(path.relative_to(root)):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                continue
            for line_number, rule in inspect_text(text):
                findings.append((path.relative_to(root).as_posix(), line_number, rule))
    return findings


def main() -> int:
    findings = scan()
    if findings:
        for path, line_number, rule in findings:
            print(f"{path}:{line_number}: forbidden pattern ({rule})")
        print(f"SSOT source-policy check failed: {len(findings)} finding(s).")
        return 1
    print("SSOT source-policy check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
