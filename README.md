# Bitrix Helper

HTTP-сервис для управления файлами в 1С-Битрикс через административную панель.  
Предоставляет REST API для авторизации, просмотра структуры разделов и загрузки файлов.

## Требования

- Node.js 18+
- npm

## Установка

```bash
npm install
```

## Настройка

Отредактируйте `config.json` перед запуском:

```json
{
  "siteUrl": "https://example.bitrix.ru",
  "adminPath": "/bitrix/admin/index.php",
  "maxRetries": 3,
  "timeout": 30000,
  "iblockId": 6,
  "sectionId": 0,
  "maxDepth": 5,
  "ignoreSSL": true
}
```

| Поле        | Описание                                               | По умолчанию       |
|-------------|--------------------------------------------------------|--------------------|
| `siteUrl`   | URL сайта Битрикс                                      | —                  |
| `adminPath` | Путь к точке входа в админку                           | `/bitrix/admin`    |
| `maxRetries`| Число повторных попыток при ошибках HTTP               | `3`                |
| `timeout`   | Таймаут запроса, мс                                    | `30000`            |
| `iblockId`  | ID инфоблока файлового менеджера                       | `6`                |
| `sectionId` | ID корневого раздела для построения дерева / листинга  | `0`                |
| `maxDepth`  | Максимальная глубина дерева разделов                   | `5`                |
| `ignoreSSL` | Игнорировать ошибки SSL-сертификата                    | `true`             |

## Запуск

```bash
npm start
# или напрямую:
node src/server.js
```

По умолчанию сервер стартует на порту **3000**.  
Переменная окружения `PORT` позволяет изменить порт:

```bash
PORT=8080 node src/server.js
```

## Развёртывание (Production)

При использовании **Supervisor** для фонового запуска приложения, **не используйте `npm start`**. Это приводит к тому, что при рестарте создаются зависшие процессы Node.js, которые продолжают занимать порт.

Вместо этого используйте **прямой вызов `node`**.

Пример конфигурационного файла (обычно `/etc/supervisor/conf.d/bitrix-helper.conf`):

```ini
[program:bitrix-helper]
; Укажите абсолютные пути к node и вашему скрипту
command=/usr/bin/node /абсолютный/путь/к/вашему/проекту/src/server.js
directory=/абсолютный/путь/к/вашему/проекту/
autostart=true
autorestart=true
user=www-data ; Имя пользователя сервера
```

После изменения конфигурации обновите Supervisor:
```bash
supervisorctl reread
supervisorctl update
supervisorctl restart bitrix-helper
```

## REST API

Все защищённые эндпоинты требуют заголовок:

```
Authorization: Bearer <token>
```

### POST `/auth/login`

Авторизация, возвращает токен сессии.

**Тело запроса (JSON):**

```json
{
  "username": "admin",
  "password": "secret",
  "ignoreSSL": true
}
```

**Ответ:**

```json
{ "token": "a1b2c3..." }
```

---

### GET `/files` 🔒

Список файлов и разделов.

| Query-параметр | Описание                              |
|----------------|---------------------------------------|
| `sectionId`    | ID раздела (по умолчанию из `config`) |

```http
GET /files?sectionId=5710
```

---

### GET `/files/tree` 🔒

Рекурсивное дерево разделов.

| Query-параметр  | Описание                                        |
|-----------------|-------------------------------------------------|
| `rootSectionId` | ID корневого раздела (по умолчанию из `config`) |
| `maxDepth`      | Максимальная глубина (по умолчанию из `config`) |

```http
GET /files/tree?rootSectionId=5710&maxDepth=3
```

---

### POST `/files/upload` 🔒

Загрузка файла в раздел.

**Тип запроса:** `multipart/form-data`

| Поле         | Тип    | Описание                                    |
|--------------|--------|---------------------------------------------|
| `file`       | File   | Загружаемый файл                            |
| `sectionId`  | string | ID раздела назначения                       |
| `uploadDate` | string | Дата документа в формате `YYYY-MM-DD` (опц.)|

---

### GET `/health`

Проверка работоспособности сервиса.

```json
{ "status": "ok" }
```

## Структура проекта

```
bitrix-helper/
├── config.json           # Конфигурация подключения
├── package.json
├── public/               # Статика (фронтенд, если есть)
└── src/
    ├── index.js          # Точка входа (запускает server.js)
    ├── server.js         # Express-сервер, REST API
    ├── BitrixClient.js   # Фасад — публичный API клиента
    └── bitrix/           # Внутренние модули
        ├── HttpClient.js       # HTTP-транспорт, управление cookies
        ├── AuthService.js      # Авторизация / выход / проверка сессии
        ├── HtmlParser.js       # Парсинг HTML-страниц админки
        ├── FileTreeService.js  # Построение и экспорт дерева разделов
        ├── FileUploadService.js# Загрузка файлов (multipart)
        ├── encoding.js         # Транслитерация, кодировки, multipart
        └── __tests__/          # Юнит-тесты
```

## Использование `BitrixClient` программно

```javascript
import { BitrixClient } from './src/BitrixClient.js';

const client = new BitrixClient('https://example.bitrix.ru', {
  iblockId: 6,
  ignoreSSL: true
});

await client.login('admin', 'password');

// Список файлов в разделе
const files = await client.getUserFiles(5710);

// Дерево разделов
const tree = await client.buildFileTree(5710, 3);

// Загрузка файла
const buf = fs.readFileSync('./document.pdf');
await client.uploadFile(5710, 'document.pdf', buf);

await client.logout();
```
