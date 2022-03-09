

from mimetypes import init
from typing import Optional
from uuid import UUID, uuid4
from pydantic import BaseModel


class Client(BaseModel):
    hostname: str
    serialno: str
    productid: str
    discoverdip: str
