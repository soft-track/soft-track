# ---- build ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables at BUILD time, not runtime, so the API URL has
# to be known here. It points at the host's published backend port because the
# browser -- not this container -- is what calls the API.
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Where the browser app is reachable, baked into the Open Graph tags in
# index.html so a link to this instance unfurls with an absolute image and
# URL. Same value as the backend's APP_BASE_URL, and build time for the same
# reason as above: there is no server here to fill it in per request.
ARG APP_BASE_URL=http://localhost:5173
ENV APP_BASE_URL=$APP_BASE_URL

RUN npm run build

# ---- serve ----
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
