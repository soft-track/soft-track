"""Seed the database with a demo user, team, project, labels, and issues.

Run with:  python seed.py
"""

from sqlmodel import Session, select

from web import engine, init_db
from lib_utils.password import hash_password
from lib_softtrack import statuses as statuses_service
from lib_softtrack.tables import (
    Issue,
    IssueLabelLink,
    IssuePriority,
    Label,
    Project,
    Team,
    TeamMember,
    TeamRole,
    User,
)

DEMO_EMAIL = "demo@softtrack.dev"
DEMO_PASSWORD = "password123"


def run():
    init_db()
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == DEMO_EMAIL)).first()
        if existing:
            print(f"Demo user already exists: {DEMO_EMAIL} / {DEMO_PASSWORD}")
            return

        user = User(
            email=DEMO_EMAIL,
            username="demo",
            hashed_password=hash_password(DEMO_PASSWORD),
            full_name="Demo User",
            avatar_color="#6366f1",
            # The seeded instance has to have somebody who can reach the admin
            # console, and this is its only account.
            is_site_admin=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        team = Team(name="Engineering", key="ENG", description="Core engineering team")
        session.add(team)
        session.commit()
        session.refresh(team)

        session.add(TeamMember(team_id=team.id, user_id=user.id, role=TeamRole.admin))
        # This script writes rows directly rather than going through
        # `create_team`, so it has to create the default workflow itself. A
        # team with no statuses has nowhere to put an issue.
        statuses_service.create_default_statuses(session, team.id)
        session.commit()

        project = Project(
            team_id=team.id,
            name="SoftTrack MVP",
            description="Ship the first self-hostable version",
            color="#6366f1",
        )
        session.add(project)
        session.commit()
        session.refresh(project)

        label_bug = Label(team_id=team.id, name="Bug", color="#ef4444")
        label_feature = Label(team_id=team.id, name="Feature", color="#22c55e")
        label_design = Label(team_id=team.id, name="Design", color="#8b5cf6")
        session.add_all([label_bug, label_feature, label_design])
        session.commit()
        session.refresh(label_bug)
        session.refresh(label_feature)
        session.refresh(label_design)

        # The team's own statuses, created with it. The demo data names the
        # columns of the default workflow rather than a fixed enum, which is
        # what a team's board is now.
        statuses = {
            status.name: status
            for status in statuses_service.team_statuses(session, team.id)
        }

        demo_issues = [
            (
                "Set up CI pipeline",
                "Done",
                IssuePriority.high,
                [label_feature],
            ),
            (
                "Design the kanban board layout",
                "Done",
                IssuePriority.medium,
                [label_design],
            ),
            (
                "Implement JWT auth",
                "In Progress",
                IssuePriority.urgent,
                [label_feature],
            ),
            (
                "Drag and drop issue cards",
                "In Progress",
                IssuePriority.high,
                [label_feature],
            ),
            (
                "Fix avatar color hashing bug",
                "Todo",
                IssuePriority.low,
                [label_bug],
            ),
            ("Write onboarding docs", "Todo", IssuePriority.medium, []),
            (
                "Add keyboard shortcuts",
                "Backlog",
                IssuePriority.no_priority,
                [label_feature],
            ),
            (
                "Dark mode support",
                "Backlog",
                IssuePriority.low,
                [label_design],
            ),
        ]

        for title, status, priority, labels in demo_issues:
            number = team.next_issue_number
            team.next_issue_number += 1
            session.add(team)

            issue = Issue(
                team_id=team.id,
                project_id=project.id,
                number=number,
                title=title,
                status_id=statuses[status].id,
                priority=priority,
                assignee_id=user.id,
                creator_id=user.id,
            )
            session.add(issue)
            session.commit()
            session.refresh(issue)

            for label in labels:
                session.add(IssueLabelLink(issue_id=issue.id, label_id=label.id))
            session.commit()

        print("Seeded demo data:")
        print(f"  Login: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print(f"  Team: {team.name} ({team.key})")
        print(f"  Project: {project.name}")
        print(f"  Issues: {len(demo_issues)}")


if __name__ == "__main__":
    run()
