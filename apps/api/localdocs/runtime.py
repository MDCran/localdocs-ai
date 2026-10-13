from sqlalchemy.ext.asyncio import AsyncSession

from localdocs.config import get_settings
from localdocs.models import AppSetting
from localdocs.schemas import RuntimeSettings


async def read_runtime(session: AsyncSession) -> RuntimeSettings:
    stored = await session.get(AppSetting, "runtime")
    if stored:
        return RuntimeSettings.model_validate(stored.value)
    return RuntimeSettings(chat_model=get_settings().chat_model)
