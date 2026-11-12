export APP_LIFE_CONSOLE_DB_PASSWORD=$(derive_entropy "${app_entropy_identifier}-DB_PASSWORD" | head -c32)
