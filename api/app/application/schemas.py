from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def strong_password(cls, v: str) -> str:
        if not any(c.isupper() for c in v) or not any(c.isdigit() for c in v) or not any(not c.isalnum() for c in v):
            raise ValueError("Password must include uppercase, number, and symbol")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TransferRequestDTO(BaseModel):
    from_address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")
    to_address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")
    amount_eth: float = Field(gt=0)


class TransactionEventDTO(BaseModel):
    user_id: str
    wallet_address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")
    amount_usd: float = Field(gt=0)
    token_symbol: str
    chain_id: int = Field(gt=0)
    hour_of_day: int = Field(ge=0, le=23)
    device_fingerprint: str
    destination_risk_score: float = Field(ge=0, le=1)


class BehaviorEventDTO(BaseModel):
    user_id: str
    event_type: str
    session_id: str
    geo_country: str
    platform: str
    event_ts: int = Field(gt=0)


class SwapRecommendationRequestDTO(BaseModel):
    user_id: str
    from_token: str
    to_token: str
    amount: float = Field(gt=0)
    slippage_tolerance_bps: int = Field(ge=1, le=500)
    urgency: str = Field(pattern=r"^(low|medium|high)$")


class InferenceResponse(BaseModel):
    score: float
    label: str
    metadata: dict[str, float | str | int]


class QuoteRequestDTO(BaseModel):
    chain: str = Field(min_length=2, max_length=32)
    from_token: str = Field(min_length=1, max_length=32)
    to_token: str = Field(min_length=1, max_length=32)
    amount: float = Field(gt=0)
    slippage_bps: int = Field(ge=1, le=1000)


class QuoteResponseDTO(BaseModel):
    route_id: str
    provider: str
    route: list[str]
    expected_out: float
    estimated_gas: int
    score: float


class ExecuteRequestDTO(BaseModel):
    chain: str = Field(min_length=2, max_length=32)
    route_id: str = Field(min_length=3, max_length=128)
    from_token: str = Field(min_length=1, max_length=32)
    to_token: str = Field(min_length=1, max_length=32)
    amount: float = Field(gt=0)
    min_out: float = Field(gt=0)
    max_retries: int = Field(ge=0, le=3, default=1)


class ZTraderEvidenceSourceDTO(BaseModel):
    provider: str = Field(min_length=1, max_length=128)
    reference: str | None = Field(default=None, max_length=1024)
    observed_at: str = Field(min_length=1, max_length=64)


class ZTraderOnchainEvidenceDataDTO(BaseModel):
    holder_count: int | None = Field(default=None, ge=0)
    top10_holder_pct: float | None = Field(default=None, ge=0, le=100)
    net_flow_usd_24h: float | None = None
    smart_money_net_flow_usd_24h: float | None = None
    liquidity_usd: float | None = Field(default=None, ge=0)
    liquidity_change_pct_24h: float | None = None
    estimated_exit_price_impact_pct: float | None = Field(default=None, ge=0)
    deployer_flags: list[str] = Field(default_factory=list)
    wallet_cluster_flags: list[str] = Field(default_factory=list)


class ZTraderOnchainEvidenceRequestDTO(BaseModel):
    version: str = Field(default="1.0", pattern=r"^1\.0$")
    trace_id: str = Field(min_length=1, max_length=128)
    chain: str = Field(min_length=1, max_length=64)
    address: str = Field(min_length=1, max_length=256)


class ZTraderOnchainEvidenceResponseDTO(BaseModel):
    version: str = Field(default="1.0", pattern=r"^1\.0$")
    trace_id: str
    chain: str
    address: str
    observed_at: str
    freshness_seconds: int = Field(ge=0)
    quality: str = Field(pattern=r"^(VERIFIED|INFERRED|PARTIAL|UNAVAILABLE)$")
    sources: list[ZTraderEvidenceSourceDTO] = Field(min_length=1)
    evidence: ZTraderOnchainEvidenceDataDTO
