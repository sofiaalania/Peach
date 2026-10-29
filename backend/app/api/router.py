from fastapi import APIRouter

from app.api.routes import ai, health, items

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(health.router)
api_router.include_router(items.router)
api_router.include_router(ai.router)
