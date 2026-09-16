#!/usr/bin/env python3
"""Verify a claimed Naya MCUboot signing private key WITHOUT trusting anyone.

The stock firmware images carry a KEYHASH TLV = SHA256 of the signing public
key. Any genuine private key must derive a public key whose hash matches.
Usage:  python3 verify-signing-key.py <private-key.pem>
Requires: pip install cryptography
Exit 0 = MATCH (key is genuine), 1 = no match, 2 = usage/load error.
"""
import hashlib
import sys

# SHA256 of the RSA-2048 signing public key, extracted from the KEYHASH TLV
# (type 0x01) present in ALL 15 stock images: every base epoch (left/right,
# incl. _64 second-revision boards) AND the module image (sz175136).
# => ONE key signs everything; this single hash is the acceptance criterion.
EXPECTED_KEYHASH = bytes.fromhex(
    "de8b07187913e6e788306618e4166e38"
    "a8c2eda99b68970d17fd00e75fd5b972"
)


def candidates(pub):
    """SHA256 over the common public-key encodings (imgtool format drift)."""
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat)
    out = {}
    out["SPKI-DER"] = hashlib.sha256(
        pub.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    ).digest()
    out["PKCS1-DER"] = hashlib.sha256(
        pub.public_bytes(Encoding.DER, PublicFormat.PKCS1)
    ).digest()
    nums = pub.public_numbers()
    out["raw-modulus"] = hashlib.sha256(
        nums.n.to_bytes(256, "big")).digest()
    out["raw-n-plus-e"] = hashlib.sha256(
        nums.n.to_bytes(256, "big") + nums.e.to_bytes(4, "big")).digest()
    return out


def main():
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <private-key.pem>", file=sys.stderr)
        return 2
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        from cryptography.hazmat.primitives.asymmetric import rsa, padding
        from cryptography.hazmat.primitives import hashes
    except ImportError:
        print("need: pip install cryptography", file=sys.stderr)
        return 2
    try:
        with open(sys.argv[1], "rb") as f:
            priv = load_pem_private_key(f.read(), password=None)
    except Exception as e:
        print(f"cannot load key: {e}", file=sys.stderr)
        return 2
    if not isinstance(priv, rsa.RSAPrivateKey) or priv.key_size != 2048:
        print(f"not an RSA-2048 private key (got {type(priv).__name__}, "
              f"{getattr(priv, 'key_size', '?')} bits)", file=sys.stderr)
        return 2
    pub = priv.public_key()
    print(f"expected KEYHASH: {EXPECTED_KEYHASH.hex()}")
    match = None
    for name, digest in candidates(pub).items():
        mark = "  <-- MATCH" if digest == EXPECTED_KEYHASH else ""
        print(f"  {name:14s} {digest.hex()}{mark}")
        if digest == EXPECTED_KEYHASH:
            match = name
    if not match:
        print("RESULT: NO MATCH — this key did not sign the stock firmware.")
        return 1
    # possession proof: RSA-PSS sign/verify roundtrip (MCUboot uses PSS)
    msg = b"naya-reflow key verification probe"
    sig = priv.sign(msg, padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                                     salt_length=32),
                    hashes.SHA256())
    pub.verify(sig, msg, padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                                     salt_length=32),
               hashes.SHA256())
    print(f"RESULT: MATCH via {match} + RSA-PSS roundtrip OK — key is genuine.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
