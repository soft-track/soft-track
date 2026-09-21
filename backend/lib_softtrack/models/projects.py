from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#6366f1"


class ProjectRead(BaseModel):
    id: int
    team_id: int
    name: str
    description: Optional[str] = None
    color: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
