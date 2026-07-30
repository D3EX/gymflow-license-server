#!/usr/bin/env python3
"""
generate_keys.py

Run this ONCE, on your own machine, completely offline.
It creates your developer EC key pair for GymFlow Admin licensing.

- private_key.pem  -> KEEP SECRET. Never put this in the app, never commit it,
                       never send it anywhere. This is what lets you sign
                       license codes. Back it up somewhere safe (password
                       manager, encrypted drive, etc.) — if you lose it you
                       can't issue new licenses, and if someone else gets it
                       they can issue licenses too.
- public_key_b64.txt -> Safe to embed in the app. It can only VERIFY
                         signatures, never create them. Paste its contents
                         into DEVELOPER_PUBLIC_KEY_B64 in DeviceLicense.kt.

Usage:
    python3 generate_keys.py

Requires: pip install cryptography
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
import base64
import os
import sys

PRIVATE_KEY_FILE = "private_key.pem"
PUBLIC_KEY_FILE = "public_key_b64.txt"


def main():
    if os.path.exists(PRIVATE_KEY_FILE):
        print(f"'{PRIVATE_KEY_FILE}' already exists in this folder.")
        answer = input("Overwrite it and invalidate all previously issued licenses? [y/N]: ")
        if answer.strip().lower() != "y":
            print("Aborted. Nothing was changed.")
            sys.exit(0)

    # Same curve as the app's Keystore key: secp256r1 (a.k.a. P-256 / prime256v1)
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    public_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    public_b64 = base64.b64encode(public_der).decode("ascii")

    with open(PRIVATE_KEY_FILE, "wb") as f:
        f.write(private_pem)
    os.chmod(PRIVATE_KEY_FILE, 0o600)

    with open(PUBLIC_KEY_FILE, "w") as f:
        f.write(public_b64)

    print("Done.\n")
    print(f"Private key written to ./{PRIVATE_KEY_FILE} (permissions set to 600).")
    print("  -> Back this up somewhere safe. Keep it off of GitHub and off the device.\n")
    print(f"Public key (base64) written to ./{PUBLIC_KEY_FILE}:\n")
    print(public_b64)
    print("\nPaste that string into DEVELOPER_PUBLIC_KEY_B64 in DeviceLicense.kt.")


if __name__ == "__main__":
    main()
