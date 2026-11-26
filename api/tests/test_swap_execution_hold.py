import pytest
from app.application.swap import SwapOrchestrator


@pytest.mark.parametrize(
    ("path", "payload", "expected_error"),
    [
        (
            "/quote",
            {
                "chain": "ethereum",
                "from_token": "ETH",
                "to_token": "USDC",
                "amount": 1,
                "slippage_bps": 100,
            },
            "swap_quotes_unavailable",
        ),
        (
            "/execute",
            {
                "chain": "ethereum",
                "route_id": "route-test",
                "from_token": "ETH",
                "to_token": "USDC",
                "amount": 1,
                "min_out": 0.9,
                "max_retries": 1,
            },
            "swap_execution_disabled",
        ),
    ],
)
def test_swap_routes_fail_closed_without_orchestration(
    api_client, monkeypatch, path, payload, expected_error
):
    def unexpected_orchestration(*args, **kwargs):
        raise AssertionError("swap orchestration must not run while execution is held")

    monkeypatch.setattr(SwapOrchestrator, "fetch_quotes", unexpected_orchestration)

    response = api_client.post(path, json=payload)

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": expected_error}
