from contextlib import asynccontextmanager
from datetime import UTC, datetime
from fastapi import FastAPI, Depends, HTTPException
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.application.ai import FeaturePipeline, FeatureVector, IntelligenceService, VectorStore
from app.application.schemas import (
    BehaviorEventDTO,
    InferenceResponse,
    LoginRequest,
    RegisterRequest,
    SwapRecommendationRequestDTO,
    TokenResponse,
    TransactionEventDTO,
    TransferRequestDTO,
    QuoteRequestDTO,
    QuoteResponseDTO,
    ExecuteRequestDTO,
    ZTraderEvidenceSourceDTO,
    ZTraderOnchainEvidenceDataDTO,
    ZTraderOnchainEvidenceRequestDTO,
    ZTraderOnchainEvidenceResponseDTO,
)
from app.middleware.security_unified import UnifiedSecurityMiddleware, enforce_runtime_prerequisites
from app.middleware.idempotency_global import GlobalIdempotencyMiddleware
from app.application.services import AuthService, WalletService
from app.application.swap import SwapOrchestrator, SwapExecutionError
from app.infrastructure.blockchain import EthereumClient
from app.infrastructure.db import engine, Base
from app.infrastructure.repositories import UserRepository
from app.interfaces.http.deps import require_user, session_dep

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    enforce_runtime_prerequisites()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="ZWallet API", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(UnifiedSecurityMiddleware)
app.add_middleware(GlobalIdempotencyMiddleware)

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(_, exc):
    raise HTTPException(status_code=429, detail="Rate limit exceeded") from exc


@app.post("/v1/auth/register", response_model=TokenResponse)
@limiter.limit("10/minute")
async def register(payload: RegisterRequest, session: AsyncSession = Depends(session_dep)) -> TokenResponse:
    try:
        token = await AuthService(UserRepository(session)).register(payload.email, payload.password)
        return TokenResponse(access_token=token)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Email already registered") from exc


@app.post("/v1/auth/login", response_model=TokenResponse)
@limiter.limit("15/minute")
async def login(payload: LoginRequest, session: AsyncSession = Depends(session_dep)) -> TokenResponse:
    token = await AuthService(UserRepository(session)).login(payload.email, payload.password)
    return TokenResponse(access_token=token)


@app.post("/v1/wallet/transfer")
@limiter.limit("5/minute")
async def transfer(payload: TransferRequestDTO, _: str = Depends(require_user)) -> dict:
    # Removed private_key from payload. 
    # Shifting to Orchestration flow: Validate -> Simulate -> Request Signing
    request_id = await WalletService(EthereumClient()).request_transfer_signature(
        payload.from_address, payload.to_address, payload.amount_eth
    )
    return {"status": "pending_signature", "request_id": request_id}


@app.post("/v1/ai/inference/transaction-anomaly", response_model=InferenceResponse)
@limiter.limit("60/minute")
async def transaction_anomaly_inference(payload: TransactionEventDTO, _: str = Depends(require_user)) -> InferenceResponse:
    pipeline = FeaturePipeline()
    service = IntelligenceService(VectorStore(provider="pgvector"))
    features = pipeline.tx_features(
        amount_usd=payload.amount_usd,
        hour_of_day=payload.hour_of_day,
        destination_risk_score=payload.destination_risk_score,
        chain_id=payload.chain_id,
    )
    result = await service.detect_transaction_anomaly(payload.user_id, payload.wallet_address, features)
    return InferenceResponse(**result)


@app.post("/v1/ai/inference/user-behavior", response_model=InferenceResponse)
@limiter.limit("90/minute")
async def user_behavior_inference(payload: BehaviorEventDTO, _: str = Depends(require_user)) -> InferenceResponse:
    pipeline = FeaturePipeline()
    service = IntelligenceService(VectorStore(provider="weaviate"))
    features = pipeline.behavior_features(
        event_type=payload.event_type,
        platform=payload.platform,
        geo_country=payload.geo_country,
    )
    result = await service.analyze_user_behavior(payload.user_id, payload.session_id, features)
    return InferenceResponse(**result)


@app.post("/v1/ai/inference/swap-recommendation", response_model=InferenceResponse)
@limiter.limit("60/minute")
async def swap_recommendation_inference(
    payload: SwapRecommendationRequestDTO, _: str = Depends(require_user)
) -> InferenceResponse:
    service = IntelligenceService(VectorStore(provider="pgvector"))
    urgency_map = {"low": 0.2, "medium": 0.5, "high": 0.8}
    feature_vector = [
        min(payload.amount / 50000, 1.0),
        payload.slippage_tolerance_bps / 500,
        urgency_map[payload.urgency],
    ]
    result = await service.smart_swap_recommendation(
        FeatureVector(values=feature_vector, tags={"kind": "swap"}),
        from_token=payload.from_token,
        to_token=payload.to_token,
        amount=payload.amount,
    )
    return InferenceResponse(**result)


@app.post("/quote", response_model=list[QuoteResponseDTO])
@limiter.limit("30/minute")
async def quote(payload: QuoteRequestDTO, _: str = Depends(require_user)) -> list[QuoteResponseDTO]:
    orchestrator = SwapOrchestrator()
    quotes = orchestrator.fetch_quotes(payload.from_token, payload.to_token, payload.amount, payload.slippage_bps)
    normalized = orchestrator.normalize_routes(quotes)
    return [QuoteResponseDTO(**quote.__dict__) for quote in normalized]


@app.post("/execute")
@limiter.limit("20/minute")
async def execute(payload: ExecuteRequestDTO, _: str = Depends(require_user)) -> dict:
    orchestrator = SwapOrchestrator()
    quotes = orchestrator.fetch_quotes(payload.from_token, payload.to_token, payload.amount, slippage_bps=100)
    candidates = [q for q in orchestrator.normalize_routes(quotes) if q.route_id == payload.route_id]
    if not candidates:
        candidates = orchestrator.normalize_routes(quotes)
    try:
        return orchestrator.execute_with_fallback(candidates, min_out=payload.min_out, max_retries=payload.max_retries)
    except SwapExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post(
    "/v1/integrations/ztrader/onchain-evidence",
    response_model=ZTraderOnchainEvidenceResponseDTO,
)
@limiter.limit("30/minute")
async def ztrader_onchain_evidence(
    payload: ZTraderOnchainEvidenceRequestDTO,
    _: str = Depends(require_user),
) -> ZTraderOnchainEvidenceResponseDTO:
    """Return explicit read-only evidence state without exposing signing authority."""
    observed_at = datetime.now(UTC).isoformat()
    return ZTraderOnchainEvidenceResponseDTO(
        trace_id=payload.trace_id,
        chain=payload.chain,
        address=payload.address,
        observed_at=observed_at,
        freshness_seconds=0,
        quality="UNAVAILABLE",
        sources=[
            ZTraderEvidenceSourceDTO(
                provider="zwallet:collector-status",
                reference=None,
                observed_at=observed_at,
            )
        ],
        evidence=ZTraderOnchainEvidenceDataDTO(),
    )
