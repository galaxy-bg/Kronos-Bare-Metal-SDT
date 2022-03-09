from multiprocessing.connection import Client
from typing import List
from fastapi import FastAPI
from .models import Client

app = FastAPI()

db: List[Client] = [ 
    Client(
        hostname="CZ11111111", 
        serialno="CZ11111111", 
        productid="111111-b21", 
        discoverdip="192.168.88.10"
    ),
    Client(
        hostname="CZ22222222", 
        serialno="CZ22222222", 
        productid="222222-b21", 
        discoverdip="192.168.88.20"
    )
]

@app.get("/")
def root():
    return {"API Server Status": "Started"}

@app.get("/ip")
def ip():
    with open('node_ip', 'r') as f:
        node_ip=f.read()
    return {"Registered IP": node_ip }

@app.get("/api/v1/clients")
async def fetch_clients():
    return db;

@app.post("/api/v1/clients")
async def register_client(client: Client):
    db.append(client)
    return {"hostname": client.hostname}

@app.post("/api/v1/clients")
async def register_client(client: Client):
    db.append(client)
    return {"hostname": client.hostname}
