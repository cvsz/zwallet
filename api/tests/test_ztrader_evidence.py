from __future__ import annotations

from app.application.ztrader_evidence import (
    ZTraderEvidenceRequest,
    build_collector_status_evidence,
)


def test_ztrader_evidence_is_explicitly_unavailable_without_collectors() -> None:
    result = build_collector_status_evidence(
        ZTraderEvidenceRequest(
            trace_id="trace-001",
            chain="ethereum",
            address="0x1111111111111111111111111111111111111111",
        )
    )

    assert result.version == "1.0"
    assert result.quality == "UNAVAILABLE"
    assert result.trace_id == "trace-001"
    assert result.sources[0].provider == "zwallet:collector-status"
    assert result.evidence.holder_count is None
    assert result.evidence.smart_money_net_flow_usd_24h is None
    assert result.evidence.liquidity_usd is None
    assert result.evidence.deployer_flags == []
    assert result.evidence.wallet_cluster_flags == []


def test_ztrader_evidence_contract_has_no_signing_or_key_material() -> None:
    result = build_collector_status_evidence(
        ZTraderEvidenceRequest(trace_id="trace-002", chain="solana", address="TokenMint")
    )
    payload = result.model_dump(mode="json")
    serialized = str(payload).lower()

    assert "private_key" not in serialized
    assert "mnemonic" not in serialized
    assert "signature" not in serialized
    assert "mpc" not in serialized
