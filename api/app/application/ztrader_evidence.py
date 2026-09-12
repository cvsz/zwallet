from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


class ZTraderEvidenceRequest(BaseModel):
    trace_id: str = Field(min_length=1, max_length=128)
    chain: str = Field(min_length=1, max_length=64)
    address: str = Field(min_length=1, max_length=256)


class EvidenceSource(BaseModel):
    provider: str = Field(min_length=1, max_length=128)
    reference: str | None = Field(default=None, max_length=1024)
    observed_at: datetime


class ZTraderEvidenceValues(BaseModel):
    holder_count: int | None = Field(default=None, ge=0)
    top10_holder_pct: float | None = Field(default=None, ge=0, le=100)
    net_flow_usd_24h: float | None = None
    smart_money_net_flow_usd_24h: float | None = None
    liquidity_usd: float | None = Field(default=None, ge=0)
    liquidity_change_pct_24h: float | None = None
    estimated_exit_price_impact_pct: float | None = Field(default=None, ge=0)
    deployer_flags: list[str] = Field(default_factory=list)
    wallet_cluster_flags: list[str] = Field(default_factory=list)


class ZTraderEvidenceResponse(BaseModel):
    version: Literal["1.0"] = "1.0"
    trace_id: str
    chain: str
    address: str
    observed_at: datetime
    freshness_seconds: int = Field(ge=0)
    quality: Literal["VERIFIED", "INFERRED", "PARTIAL", "UNAVAILABLE"]
    sources: list[EvidenceSource]
    evidence: ZTraderEvidenceValues


def build_collector_status_evidence(payload: ZTraderEvidenceRequest) -> ZTraderEvidenceResponse:
    """Return an explicit no-data envelope until chain collectors provide verified evidence.

    This boundary intentionally does not derive holder, smart-money, deployer, liquidity,
    or wallet-cluster facts from unrelated wallet state. Missing collectors must remain
    UNAVAILABLE instead of being treated as safe.
    """
    now = datetime.now(UTC)
    return ZTraderEvidenceResponse(
        trace_id=payload.trace_id,
        chain=payload.chain,
        address=payload.address,
        observed_at=now,
        freshness_seconds=0,
        quality="UNAVAILABLE",
        sources=[
            EvidenceSource(
                provider="zwallet:collector-status",
                reference=None,
                observed_at=now,
            )
        ],
        evidence=ZTraderEvidenceValues(),
    )
