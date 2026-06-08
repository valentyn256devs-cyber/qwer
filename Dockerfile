# ==========================================
# Етап 1: Збірка додатка (Build stage)
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Копіюємо файли залежностей
COPY package*.json ./

# Встановлюємо ВСІ залежності (включаючи devDependencies для TypeScript)
RUN npm ci

# Копіюємо вихідний код
COPY . .

# Компілюємо TypeScript у JavaScript (генерується папка dist)
RUN npm run build

# ==========================================
# Етап 2: Фінальний образ для запуску (Production stage)
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Переносимо змінні оточення за замовчуванням
NODE_ENV=production

# Копіюємо package.json та package-lock.json
COPY package*.json ./

# Встановлюємо ТІЛЬКИ production залежності (без typescript, ts-node тощо)
RUN npm ci --only=production

# Копіюємо скомпіований код з першого етапу
COPY --from=builder /usr/src/app/dist ./dist

# Відкриваємо порт, на якому працює NestJS
EXPOSE 3000

# Команда для запуску додатка
CMD ["node", "dist/main.js"]