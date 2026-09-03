import asyncio
import os
import uuid
from datetime import datetime, timezone

from database import engine, async_session
from models import Base, User, Workspace, Project, WorkspaceMembership
from security import get_password_hash

async def seed_data():
    print("Initializing database...")
    print("Database tables verified.")

    async with async_session() as db:
        # Check if admin exists
        admin_email = os.getenv("VIBUS_ADMIN_EMAIL", "admin@vibus.local")
        admin_password = os.getenv("VIBUS_ADMIN_PASSWORD")
        if not admin_password or len(admin_password) < 8:
            print("Seed aborted: Admin password is not set or is too weak.")
            return
        
        # Try to find existing admin
        from sqlalchemy import select
        res = await db.execute(select(User).where(User.email == admin_email))
        admin = res.scalar_one_or_none()
        
        if admin:
            print(f"Admin user '{admin_email}' already exists. Skipping seed.")
            return

        print(f"Creating default admin user '{admin_email}'...")
        admin = User(
            id=str(uuid.uuid4()),
            email=admin_email,
            hashed_password=get_password_hash(admin_password),
            is_active=True,
            created_at=datetime.now(timezone.utc)
        )
        db.add(admin)

        print("Creating default workspace...")
        workspace_id = str(uuid.uuid4())
        workspace = Workspace(
            id=workspace_id,
            name="Demo Workspace",
            owner_email=admin.email,
            created_at=datetime.now(timezone.utc)
        )
        db.add(workspace)

        print("Adding admin to workspace...")
        membership = WorkspaceMembership(
            workspace_id=workspace_id,
            user_id=admin.id,
            role="owner",
            created_at=datetime.now(timezone.utc)
        )
        db.add(membership)

        print("Creating default project...")
        project = Project(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            name="Demo SaaS Platform",
            slug="demo_saas_platform",
            description="A sample project to get started with Vibus",
            created_at=datetime.now(timezone.utc)
        )
        db.add(project)

        await db.commit()
        print("Seed completed successfully!")
        print(f"Login with email: {admin_email} | password: {admin_password}")

if __name__ == "__main__":
    asyncio.run(seed_data())
