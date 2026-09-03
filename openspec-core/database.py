from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import os

# Default to SQLite for zero-setup local dev, or PostgreSQL if DATABASE_URL or docker is specified
DEFAULT_DB = "sqlite+aiosqlite:///./vibus.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB)

# Ensure proper driver for async SQLite if standard sqlite url is given
if DATABASE_URL.startswith("sqlite://") and not DATABASE_URL.startswith("sqlite+aiosqlite://"):
    DATABASE_URL = DATABASE_URL.replace("sqlite://", "sqlite+aiosqlite://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")

engine_kwargs = {
    "echo": False,
}

if not is_sqlite:
    from sqlalchemy.pool import NullPool
    engine_kwargs["poolclass"] = NullPool

engine = create_async_engine(DATABASE_URL, **engine_kwargs)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with async_session() as session:
        yield session
