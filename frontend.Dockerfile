# Static frontend image. Serves index.html/app.js/styles.css/data/*.json
# on port 3000 via nginx -- the counterpart to the backend API image built
# from ./Dockerfile (port 8000). Run together via docker-compose.yml.
FROM nginx:1.27-alpine

COPY index.html app.js styles.css sw.js manifest.json /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY data/ /usr/share/nginx/html/data/
COPY config.js.template /etc/nginx/templates/config.js.template
COPY nginx.frontend.conf.template /etc/nginx/conf.d/default.conf.template
COPY docker-entrypoint.sh /usr/local/bin/orca-frontend-entrypoint

RUN chmod +x /usr/local/bin/orca-frontend-entrypoint

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null "http://localhost:${PORT:-3000}/" || exit 1

ENTRYPOINT ["/usr/local/bin/orca-frontend-entrypoint"]
