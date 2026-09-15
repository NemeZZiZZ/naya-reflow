"""Scan for NayaCreate BLE advertisers (slot 1 or 2), dump adv + GATT basics."""
import asyncio, sys
from bleak import BleakScanner, BleakClient

async def main():
    print("Scanning 25s for Naya devices...", flush=True)
    devs = await BleakScanner.discover(timeout=25.0)
    nayas = [d for d in devs
             in [(d, (d.details.get('kCBAdvDataLocalName', '') if isinstance(d.details, dict) else ''))] ] if False else []
    found = []
    for d in devs:
        name = d.name or ""
        if "naya" in name.lower():
            found.append(d)
            print(f"FOUND: name={name!r} addr={d.address} rssi={d.rssi}", flush=True)
    if not found:
        print("No Naya advertisers seen. Nearby BLE names:")
        for d in sorted(devs, key=lambda x: x.rssi or -999, reverse=True)[:15]:
            print(f"  {d.name!r} addr={d.address} rssi={d.rssi}", flush=True)
        return
    for d in found:
        try:
            async with BleakClient(d.address, timeout=15.0) as c:
                print(f"--- connected to {d.name} ---", flush=True)
                for s in c.services:
                    print(f"svc {s.uuid} ({s.description})", flush=True)
                    for ch in s.characteristics:
                        print(f"  chr {ch.uuid} props={ch.properties}", flush=True)
        except Exception as e:
            print(f"connect to {d.name} failed: {e}", flush=True)

asyncio.run(main())
