from fastapi import APIRouter

from app.api.v1.routes import agents, inventory, jobs, profiles, servers

api_router = APIRouter()
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(servers.router, prefix="/servers", tags=["servers"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
api_router.include_router(profiles.router, prefix="/profiles", tags=["profiles"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
