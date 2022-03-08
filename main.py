from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"API Server Status": "Started"}

@app.get("/ip")
def ip():
    with open('node_ip', 'r') as f:
        node_ip=f.read()
    return {"Registered IP": node_ip }

