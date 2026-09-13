from pydantic import BaseModel, ConfigDict


class LabelCreate(BaseModel):
    name: str
    color: str = "#94a3b8"


class LabelRead(BaseModel):
    id: int
    team_id: int
    name: str
    color: str

    model_config = ConfigDict(from_attributes=True)
