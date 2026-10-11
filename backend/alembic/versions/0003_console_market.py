"""Console market: Xbox and PlayStation share one transfer market

Folds the old cross / playstation / xbox platform values into "console" for settings
and price observations, so existing desks keep their history.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

OLD = "('cross', 'playstation', 'xbox')"


def upgrade() -> None:
    op.execute(f"UPDATE user_settings SET platform = 'console' WHERE platform IN {OLD}")
    op.execute(f"UPDATE market_prices SET platform = 'console' WHERE platform IN {OLD}")


def downgrade() -> None:
    op.execute("UPDATE user_settings SET platform = 'cross' WHERE platform = 'console'")
    op.execute("UPDATE market_prices SET platform = 'cross' WHERE platform = 'console'")
