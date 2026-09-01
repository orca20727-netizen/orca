import os

import uvicorn

if __name__ == '__main__':
    # BACKEND_PORT / BACKEND_HOST match the names used in .env.example;
    # PORT is kept as a fallback for compatibility with platforms (Render,
    # Railway, etc.) that inject PORT automatically.
    port = int(os.getenv('BACKEND_PORT', os.getenv('PORT', '8000')))
    host = os.getenv('BACKEND_HOST', '0.0.0.0')
    # Reload is opt-in (RELOAD=1) -- useful for local dev, but the extra
    # file-watcher process has no business running in the demo/production
    # container, so it defaults off there.
    reload_enabled = os.getenv('RELOAD', 'false').lower() in ('1', 'true', 'yes')

    print(f'Starting ORCA INSIGHT FastAPI Backend on http://localhost:{port} (also reachable via http://127.0.0.1:{port}) ...')
    print('Frontend (index.html) will auto-detect this backend and switch from Local Simulation to Live Backend mode.')
    uvicorn.run('main:app', host=host, port=port, reload=reload_enabled)
