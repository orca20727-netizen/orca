import os

import uvicorn

if __name__ == '__main__':
    port = int(os.getenv('PORT', os.getenv('BACKEND_PORT', '8000')))
    host = os.getenv('BACKEND_HOST', '0.0.0.0')
    reload_enabled = os.getenv('RELOAD', 'false').lower() in ('1', 'true', 'yes')
    uvicorn.run('main:app', host=host, port=port, reload=reload_enabled)
