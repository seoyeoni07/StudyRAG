from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str
    chroma_persist_dir: str = "./chroma_db"
    db_connection_string: str = "sqlite:///./studyrag.db"

    model_config = {"env_file": ".env"}


settings = Settings()
