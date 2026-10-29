"""Authenticated AI extraction; results are drafts and are never persisted."""

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.ai.agenda import MAX_INPUT_LENGTH, AgendaParsingError, ParsedAgenda, parse_agenda
from app.auth import CurrentUser

router = APIRouter(prefix="/ai", tags=["ai"])


class ParseAgendaRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_INPUT_LENGTH)

    @field_validator("text")
    @classmethod
    def reject_whitespace(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Agenda text cannot be whitespace only")
        return value


@router.post("/parse-agenda", response_model=ParsedAgenda, summary="Parse an agenda draft")
async def parse_agenda_draft(payload: ParseAgendaRequest, user: CurrentUser) -> ParsedAgenda:
    """Extract editable meeting fields without creating or updating an item."""
    try:
        return await parse_agenda(payload.text)
    except (AgendaParsingError, BotoCoreError, ClientError) as exc:
        # Parser errors can include provider details or model output. Keep them private.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Agenda parsing failed. Please try again later.",
        ) from exc
