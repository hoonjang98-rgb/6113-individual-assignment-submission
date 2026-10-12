"""Production WSGI entry point; wallet signing stays in the browser."""
from app import create_app

app = create_app()
