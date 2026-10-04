import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import dashboard, pipeline, material_master, recipe_master, bom_master

app = FastAPI(title="Produce.Ai Backend")

# Allow Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(pipeline.router, prefix="/api/pipeline", tags=["pipeline"])
app.include_router(material_master.router, prefix="/api/material-master", tags=["material_master"])
app.include_router(recipe_master.router, prefix="/api/recipe-master", tags=["recipe_master"])
app.include_router(bom_master.router, prefix="/api/bom-master", tags=["bom_master"])
