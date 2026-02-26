# Bitrix Helper

Инструмент для управления файлами в системе 1С-Битрикс через административную панель.

## Возможности

- Аутентификация в админ-панели Битрикс
- Просмотр списка файлов
- Просмотр списка пользователей
- Получение файлов конкретного пользователя

## Установка

```bash
npm install
```

## Использование

```bash
npm start
```

## Настройка

Отредактируйте файл `config.json` для настройки подключения:

```json
{
  "siteUrl": "https://www.volgmed.ru",
  "adminPath": "/bitrix/admin",
  "maxRetries": 3,
  "timeout": 30000
}
```

## Требования

- Node.js 18+
- NPM

## Структура проекта

```
bitrix-helper/
├── config.json          # Конфигурация подключения
├── package.json         # Зависимости проекта
├── src/
│   ├── index.js         # Главная точка входа
│   ├── BitrixClient.js  # Клиент для работы с API Битрикса
│   └── cli.js           # CLI интерфейс
└── README.md            # Документация
```

## Использование API

```javascript
import { BitrixClient } from './src/BitrixClient.js';

const client = new BitrixClient('https://example.com');

// Авторизация
await client.login('admin', 'password');

// Получение списка файлов
const files = await client.getUserFiles();

// Получение списка пользователей
const users = await client.getUsers();

// Выход
await client.logout();
```
