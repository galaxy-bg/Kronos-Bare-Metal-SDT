from fastapi import APIRouter

from app.api.v1.routes import agents, servers

api_router = APIRouter()
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(servers.router, prefix="/servers", tags=["servers"])
