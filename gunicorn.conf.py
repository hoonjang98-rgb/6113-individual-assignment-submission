"""Render process settings for the stateless, read-only Flask backend."""
import os

port = int(os.environ.get('PORT', '10000'))
if not 1 <= port <= 65535:
    raise ValueError('PORT must be between 1 and 65535.')

bind = f'0.0.0.0:{port}'
workers = 1
worker_class = 'gthread'
threads = 4
timeout = 60
accesslog = '-'
errorlog = '-'
