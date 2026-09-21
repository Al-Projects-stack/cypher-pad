# Security policy

## Supported versions

This project is a portfolio preview. Use only for review and local testing. No production support is offered yet.

* `0.1.x` preview with crypto library only

## Reporting a vulnerability

Please report suspected issues privately so we can triage before public disclosure.

* Contact the maintainer through the repository private channel
* Include affected version reproduction steps and impact notes
* Expect acknowledgement within three business days
* Expect a fix plan or scope note within fourteen days

Please avoid public issues for suspected key leakage auth bypass or data exposure. Please avoid including passwords keys ciphertext or tokens in reports. Logs must never contain tokens keys or ciphertext.

## Scope

In scope:

* Crypto package key derivation wrapping and note authentication
* Auth flow verifier handling and session policy when server lands
* Sync conflict and tombstone integrity when sync lands
* Client lock behavior memory clearing and offline cache handling when client lands

Out of scope:

* Browser OS and hosting hygiene
* Physical device seizure while unlocked
* Social engineering and coercion
* Denial of service

## Hardening plan

Server hardening will include short lived access token in memory only plus refresh rotation in strict cookie plus rate limits plus schema validation plus parameterized queries plus helmet headers plus strict Content Security Policy with no inline scripts and no third party scripts plus size limits plus locked CORS plus structured logs without secrets.

Crypto hardening includes audited primitives only plus unique salts plus upgradeable params plus domain separation plus fresh IV plus AAD binding plus non extractable keys plus memory clearing plus constant time comparison plus generic errors.
