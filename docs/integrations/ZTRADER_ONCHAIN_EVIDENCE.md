# zTrader On-chain Evidence Contract v1

zWallet is the canonical owner of wallet, chain, DEX and liquidity evidence.

This contract is read-only. It must never expose:
- private keys
- seed phrases
- MPC shares
- signing authority
- withdrawal authority

zTrader consumes normalized evidence plus provenance/freshness. Unknown fields remain null rather than being inferred as safe.
