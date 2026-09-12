def test_ztrader_onchain_evidence_is_read_only_and_explicit(api_client) -> None:
    response = api_client.post(
        "/v1/integrations/ztrader/onchain-evidence",
        headers={"Idempotency-Key": "ztrader-evidence-001"},
        json={
            "version": "1.0",
            "trace_id": "trace-ztrader-001",
            "chain": "ethereum",
            "address": "0x1111111111111111111111111111111111111111",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "1.0"
    assert body["trace_id"] == "trace-ztrader-001"
    assert body["quality"] == "UNAVAILABLE"
    assert body["sources"][0]["provider"] == "zwallet:collector-status"
    assert body["evidence"]["deployer_flags"] == []
    assert body["evidence"]["wallet_cluster_flags"] == []
    serialized = str(body).lower()
    assert "private_key" not in serialized
    assert "signature" not in serialized



def test_ztrader_onchain_evidence_rejects_invalid_chain_and_address(api_client) -> None:
    invalid_chain = api_client.post(
        "/v1/integrations/ztrader/onchain-evidence",
        headers={"Idempotency-Key": "ztrader-evidence-invalid-chain"},
        json={
            "version": "1.0",
            "trace_id": "trace-invalid-chain",
            "chain": "unknown",
            "address": "0x1111111111111111111111111111111111111111",
        },
    )
    assert invalid_chain.status_code == 422

    invalid_address = api_client.post(
        "/v1/integrations/ztrader/onchain-evidence",
        headers={"Idempotency-Key": "ztrader-evidence-invalid-address"},
        json={
            "version": "1.0",
            "trace_id": "trace-invalid-address",
            "chain": "ethereum",
            "address": "not-an-address",
        },
    )
    assert invalid_address.status_code == 422
