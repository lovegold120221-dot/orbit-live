ARG JITSI_IMAGE_VERSION=unstable
FROM ghcr.io/jitsi/web:${JITSI_IMAGE_VERSION}

USER root

COPY orbit-live-translation.js /usr/share/jitsi-meet/orbit-live-translation.js
COPY orbit-translator-client.js /usr/share/jitsi-meet/orbit-translator-client.js
COPY orbit-pcm-worklet.js /usr/share/jitsi-meet/orbit-pcm-worklet.js
COPY orbit-live-translation.css /usr/share/jitsi-meet/orbit-live-translation.css
COPY orbit-logo.svg /usr/share/jitsi-meet/orbit-logo.svg
COPY custom-config.js /defaults/orbit-custom-config.js

# Brand the stock meeting UI as Orbit, inject the OrbitAI/Donation extension, and
# proxy same-origin donation requests to the private donation gateway container.
RUN sed -i 's#</head>#<link rel="stylesheet" href="/orbit-live-translation.css?v=10" /></head>#' /usr/share/jitsi-meet/index.html \
  && sed -i 's#</body>#<script defer src="/orbit-translator-client.js?v=10"></script><script defer src="/orbit-live-translation.js?v=10"></script></body>#' /usr/share/jitsi-meet/index.html \
 && cat /defaults/orbit-custom-config.js >> /defaults/settings-config.js \
 && printf '\ninterfaceConfig.APP_NAME = "Orbit";\ninterfaceConfig.NATIVE_APP_NAME = "Orbit";\ninterfaceConfig.PROVIDER_NAME = "Orbit";\ninterfaceConfig.DEFAULT_WELCOME_PAGE_LOGO_URL = "/orbit-logo.svg";\ninterfaceConfig.SHOW_JITSI_WATERMARK = false;\ninterfaceConfig.SHOW_POWERED_BY = false;\ninterfaceConfig.JITSI_WATERMARK_LINK = "";\n' >> /defaults/interface_config.js \
  && sed -i '/location = \/config.js {/i\    location ^~ /api/donations/ {\n        proxy_pass http://orbit-donation-gateway:8090/;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        client_max_body_size 1m;\n    }\n' /defaults/meet.conf \
  && sed -i '/location = \/config.js {/i\    location ^~ /api/screen/ {\n        proxy_pass http://orbit-ai-translator:8080/screen/;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        client_max_body_size 1m;\n    }\n' /defaults/meet.conf

# Long-lived listener sockets carry both paired captions and translated audio.
RUN sed -i '/location = \/config.js {/i\    location ^~ /api/live/ {\n        proxy_pass http://orbit-ai-translator:8080/live/;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n        proxy_set_header Host $http_host;\n        proxy_read_timeout 3600s;\n        proxy_send_timeout 3600s;\n        proxy_buffering off;\n        client_max_body_size 128k;\n    }\n' /defaults/meet.conf

USER s6
