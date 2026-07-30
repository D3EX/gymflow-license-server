#!/usr/bin/env python3
"""
sign_license.py

Run this on your own machine, offline, every time a customer needs a license.

Flow:
1. Customer opens GymFlow Admin, sees their fingerprint on screen
   (something like "K3NF-92XA-B7C1-Q8ZM-1234-5678"), and sends it to you.
2. You run:  python3 sign_license.py "K3NF-92XA-B7C1-Q8ZM-1234-5678"
3. You send the printed license code back to the customer.
4. Customer pastes it into the app's activation screen.

Requires: private_key.pem in the same folder (from generate_keys.py).
Requires: pip install cryptography
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
import base64
import sys
import os

PRIVATE_KEY_FILE = "private_key.pem"


def sign_fingerprint(fingerprint: str) -> str:
    with open(PRIVATE_KEY_FILE, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)

    signature = private_key.sign(
        fingerprint.encode("utf-8"),
        ec.ECDSA(hashes.SHA256()),
    )
    return base64.b64encode(signature).decode("ascii")


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 sign_license.py \"<DEVICE-FINGERPRINT>\"")
        print('Example: python3 sign_license.py "K3NF-92XA-B7C1-Q8ZM-1234-5678"')
        sys.exit(1)

    if not os.path.exists(PRIVATE_KEY_FILE):
        print(f"Can't find '{PRIVATE_KEY_FILE}'. Run generate_keys.py first, "
              f"or copy your existing private_key.pem into this folder.")
        sys.exit(1)

    fingerprint = sys.argv[1].strip().upper()
    license_code = sign_fingerprint(fingerprint)

    print(f"\nFingerprint: {fingerprint}")
    print(f"\nLicense code (send this to the customer):\n\n{license_code}\n")


if __name__ == "__main__":
    main()
